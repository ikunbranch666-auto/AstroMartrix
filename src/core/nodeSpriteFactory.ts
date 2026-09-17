import { NodeType, NodeStatus } from '../types/domain';

/* ==========================================================================================
 * AstroMatrix · 2.5D 异构节点 Sprite 工厂
 * 严格实现施工文档 v1.3 §3（图层绘制规格）与 §4（Sprite 工厂）
 *
 * 全局成像体系：
 *   - 35° 俯视透视：所有椭圆 Y 轴压缩比 k = 0.82
 *   - 固定光源：左上 45°（方位 135° 方向），135° 迎光面提亮 20%，315° 背光面压暗 30%
 *   - 禁止 ctx.scale(1, k) 压扁描边：所有弧线一律用椭圆参数方程逐点描绘，保证物理等宽像素
 *   - DPR 封顶 2.0
 *
 * 【L1 ALERT 拆分约定 — 供 Batch 5 对接】
 *   L1_{type}_ALERT_seg 仅含 ALERT 的静态碎裂基础形态（品红能量板 + 断层裂缝 + 基础色调）；
 *   2.5D 扁圆涟漪波属事件驱动效果（进入 ALERT 时向外扩散），不烘焙进 Sprite，
 *   由 TopologyCanvas 运行时在 L1 之上额外叠加绘制。
 * ========================================================================================== */

/* ================================ 公开接口（§4.2） ================================ */

export interface SpriteEntry {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  anchorX: number; // 中心锚点偏移（像素）
  anchorY: number;
}

export interface NodeSpriteSheet {
  get(key: string): SpriteEntry | undefined;
  has(key: string): boolean;
  totalCount: number;
}

/**
 * 【调试辅助】离屏画布 -> Sprite Key 的全局弱引用登记表
 * 用途：渲染层只拿得到 canvas 对象（drawImage 的源），调试/自检时需反查其语义 key。
 * 用 WeakMap 保证画布被回收时登记项自动消失，不产生额外内存压力。
 */
export const spriteKeyByCanvas = new WeakMap<HTMLCanvasElement, string>();

/* ================================ 几何基准（§3.1） ================================ */

/** 全局 35° 俯视 Y 轴压缩比 */
const K_Y = 0.82;

/** 四类节点尺寸基准（施工文档 §3.1 尺寸基准表） */
interface NodeGeom {
  rOuter: number;
  rY: number;
  rL4Hole: number;
  rL1Outer: number;
  rL1Inner: number;
  rL2: number;
  rL3Hub: number;
  rL5: number;
  rL6: number;
}

function makeGeom(rOuter: number): NodeGeom {
  return {
    rOuter,
    rY: rOuter * K_Y, // 短半轴
    rL4Hole: rOuter * 0.55, // L4 装甲开口长半轴
    rL1Outer: rOuter * 1.15, // L1 能量板外径
    rL1Inner: rOuter * 0.58, // L1 能量板内径
    rL2: rOuter * 0.95, // L2 导轨半径
    rL3Hub: rOuter * 0.55 * 0.45, // L3 中心加固节点盘 = R_L4_hole * 0.45
    rL5: rOuter * 0.55 * 0.90, // L5 活性环 = R_L4_hole * 0.90
    rL6: rOuter * 0.55 * 0.92, // L6 外壳 = R_L4_hole * 0.92
  };
}

/** 尺寸基准表：HUB 8.0 / RELAY 7.0 / PROBE 5.0 / SCANNER 6.0 */
const GEOM: Record<NodeType, NodeGeom> = {
  HUB: makeGeom(8.0),
  RELAY: makeGeom(7.0),
  PROBE: makeGeom(5.0),
  SCANNER: makeGeom(6.0),
};

const ALL_TYPES: NodeType[] = ['HUB', 'RELAY', 'PROBE', 'SCANNER'];
const ALL_STATES: NodeStatus[] = ['STABLE', 'STAGED', 'LOCKED', 'ALERT'];

/* ================================ 材质色板（§3.2） ================================ */

const COLOR = {
  cyan: '#00F0FF',
  green: '#3FB950',
  magenta: '#FF0055',
  amber: '#F59E0B',
  metalTop: '#484F58', // L2 导轨顶面亮端
  metalDark: '#21262D', // L2 导轨暗端
  beadOff: '#30363D', // L2 暗态金属珠
  trussDark: '#30363D', // L3 金属网架
  trussHighlight: '#6E7681', // L3 高光棱线
  trussTop: '#484F58', // L3 支撑柱顶面提亮
  insignia: '#8B949E', // L7 刻度面板
  insigniaLocked: '#1F6FEB', // L7 LOCKED 墨绿
  coreInner: '#E6FFFA', // L6 内核光斑内圈
} as const;

/** 状态主色映射：L1 / L6 / L7 的基色来源 */
function stateColor(state: NodeStatus): string {
  switch (state) {
    case 'LOCKED':
      return COLOR.green;
    case 'ALERT':
      return COLOR.magenta;
    default:
      return COLOR.cyan;
  }
}

/* ================================ 底层绘制辅助（不导出） ================================ */

/** 像素对齐：避免半像素导致的模糊描边 */
const snap = (v: number): number => Math.round(v * 100) / 100;

/** 极坐标 -> 椭圆参数方程取点（严禁用 ctx.scale 压扁描边） */
function ellipsePoint(cx: number, cy: number, rx: number, ry: number, angle: number): [number, number] {
  return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
}

/** 椭圆弧路径：物理等宽像素，Y 轴压缩由 ry 参数承担 */
function ellipseArcPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  steps = 24
): void {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const [x, y] = ellipsePoint(cx, cy, rx, ry, a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** 椭圆环带路径（外弧正向 + 内弧逆向，形成可填充的环形瓦片） */
function ellipseRingPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
  steps = 26
): void {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const [x, y] = ellipsePoint(cx, cy, rOuter, rOuter * K_Y, a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const [x, y] = ellipsePoint(cx, cy, rInner, rInner * K_Y, a);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * 左上 45° 固定光源的径向明暗系数
 * 光源方位角 135°（数学坐标系，x 向右 / y 向下，cos 为负即左上）
 *   - 迎光侧（135° 区域）：提亮 20% -> 1.20
 *   - 背光侧（315° 区域）：压暗 30% -> 0.70
 */
function lightFactor(angle: number): number {
  const d = Math.cos(angle - (135 * Math.PI) / 180);
  return d >= 0 ? 1 + 0.2 * d : 1 + 0.3 * d;
}

/** rgba 构造：供填充/描边使用 */
function rgba(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const DEG = Math.PI / 180;

/** 离屏画布工厂：物理像素 = CSS 像素 × dpr，逻辑坐标恒以 CSS 像素为单位 */
function createCanvas(size: number, dpr: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  // 尺寸向上取整：保证 width/height 为整数像素，供 Batch 5 直接以 1:1 drawImage 半尺寸 blit
  const s = Math.ceil(size);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(s * dpr));
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[nodeSpriteFactory] 2D 上下文创建失败');
  ctx.scale(dpr, dpr);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  return { canvas, ctx };
}

/* ================================ L1 护盾层（§3.2 L1） ================================ */
/**
 * 6 段弧形能量板（每段 52°）+ 6 处 8° 微裂隙，合计 360°，旋转中心角固定 0/60/120/180/240/300°
 * 本工厂只预渲染「单段 52° 模板」，运行时旋转 6 次 blit
 */
function drawL1Segment(ctx: CanvasRenderingContext2D, cx: number, cy: number, g: NodeGeom, state: NodeStatus): void {
  const mid = 0; // 模板段居中在 0°，运行时旋转到各旋转中心
  const half = 52 * DEG * 0.5;

  // STAGED 外径单向向外扩大 1.0px，内径不变
  const rOuter = state === 'STAGED' ? g.rL1Outer + 1.0 : g.rL1Outer;
  const rInner = g.rL1Inner;

  // 显式标注 string：COLOR 为 as const，不标注会被推断为字面量 '#00F0FF' 导致后续赋值报错
  let baseColor: string = COLOR.cyan;
  let alpha = 0.08; // STABLE：微光呼吸
  if (state === 'STAGED') {
    alpha = 0.16; // STAGED：提亮 ×2
  } else if (state === 'LOCKED') {
    baseColor = COLOR.green;
    alpha = 0.15; // LOCKED：坚固常亮
  } else if (state === 'ALERT') {
    baseColor = COLOR.magenta;
    alpha = 0.35; // ALERT：品红碎裂
  }

  // 外缘轮廓：ALERT 亦保留静态碎裂外沿（涟漪波不烘焙，见文件头说明）
  ctx.save();
  ctx.strokeStyle = rgba(baseColor, Math.min(0.9, state === 'ALERT' ? 0.55 : alpha * 4));
  ctx.lineWidth = 1.0;
  ctx.shadowColor = rgba(baseColor, 0.5);
  ctx.shadowBlur = 2;
  ellipseArcPath(ctx, cx, cy, rOuter, rOuter * K_Y, mid - half, mid + half);
  ctx.stroke();
  ctx.restore();

  // ALERT 断层裂缝：3 道确定性径向裂缝，构成"碎裂"静态基础形态
  if (state === 'ALERT') {
    ctx.save();
    ctx.strokeStyle = rgba('#000000', 0.55);
    ctx.lineWidth = 0.6;
    for (let c = 0; c < 3; c++) {
      const crackAngle = mid - half + (52 * DEG * (c + 1)) / 4 + pseudo01(c + 31) * 0.12;
      const [x1, y1] = ellipsePoint(cx, cy, rInner, rInner * K_Y, crackAngle);
      const [x2, y2] = ellipsePoint(cx, cy, rOuter, rOuter * K_Y, crackAngle);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo((x1 + x2) / 2 + 0.5, (y1 + y2) / 2);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 板体填充：沿弧长方向叠加左上光源明暗（135° 提亮 / 315° 渐隐至 alpha 0.02）
  const steps = 20;
  for (let i = 0; i < steps; i++) {
    const a0 = mid - half + (52 * DEG * i) / steps;
    const a1 = mid - half + (52 * DEG * (i + 1)) / steps + 0.004; // 微搭接防缝隙
    const aMid = (a0 + a1) / 2;
    const lf = lightFactor(aMid);
    // 315° 侧渐隐：lf 最低时按规格压至 alpha 0.02
    const segAlpha = Math.max(0.02, alpha * lf);
    ellipseRingPath(ctx, cx, cy, rOuter, rInner, a0, a1, 4);
    ctx.fillStyle = rgba(baseColor, segAlpha);
    ctx.fill();
  }
  ctx.restore();
}

/* ================================ L2 珠链层（§3.2 L2） ================================ */
/** 静态导轨：半径 R_L2 = R_outer * 0.95，厚度 0.8px，顶面渐变 #484F58 -> #21262D */
function drawL2Rail(ctx: CanvasRenderingContext2D, cx: number, cy: number, g: NodeGeom): void {
  const grad = ctx.createLinearGradient(cx - g.rL2, cy - g.rL2 * K_Y, cx + g.rL2, cy + g.rL2 * K_Y);
  grad.addColorStop(0, COLOR.metalTop); // 左上迎光端
  grad.addColorStop(1, COLOR.metalDark); // 右下背光端
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 0.8;
  ellipseArcPath(ctx, cx, cy, g.rL2, g.rL2 * K_Y, 0, Math.PI * 2, 72);
  ctx.stroke();
  ctx.restore();
}

/** 2.0px 独立金属刻度珠（暗态 / 青色亮态 / 固化绿亮态） */
function drawL2Bead(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, baseColor: string, bright: boolean): void {
  // 球体基色
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  grad.addColorStop(0, bright ? '#FFFFFF' : rgba('#7A848E', 0.9));
  grad.addColorStop(bright ? 0.45 : 0.6, baseColor);
  grad.addColorStop(1, bright ? baseColor : rgba(baseColor, 0.85));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  // 高光发光核
  if (bright) {
    ctx.shadowColor = baseColor;
    ctx.shadowBlur = 2.5;
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }
  ctx.restore();
}

/** 固定投影贴片：偏移 (+0.8, +0.8)，模糊 1.5px，rgba(0,0,0,0.45) */
function drawL2Shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 1.5;
  ctx.shadowOffsetX = 0.8;
  ctx.shadowOffsetY = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fill();
  ctx.restore();
}

/* ================================ L3 桁架层（§3.2 L3） ================================ */
/** 支撑方柱四向：右(0°) / 下(90°) / 左(180°) / 上(270°)，顶面提亮 #484F58 */
const L3_PILLAR_ANGLES = [0, 90, 180, 270].map((d) => d * DEG);

/** X 型交叉斜桁架 4 根：沿 45° / 135° / 225° / 315° 对角展开 */
const L3_BEAM_ANGLES = [45, 135, 225, 315].map((d) => d * DEG);

/** 中心加固节点盘（半径 R_L3_hub = R_L4_hole * 0.45） */
function drawL3Hub(ctx: CanvasRenderingContext2D, cx: number, cy: number, hubR: number, glowColor: string | null): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, hubR, hubR * K_Y, 0, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.metalDark;
  ctx.fill();
  ctx.strokeStyle = COLOR.trussHighlight;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  if (glowColor) {
    // LOCKED：锁死嵌光 + 铆钉点亮
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, hubR * 0.55, hubR * K_Y * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(glowColor, 0.9);
    ctx.fill();
  }
  ctx.restore();
}

/** 4 根 X 型交叉斜桁架（宽 0.8px）+ 4 个支撑方柱（0.8×0.8px），STAGED/LOCKED/ALERT 全开暴露 */
function drawL3Truss(ctx: CanvasRenderingContext2D, cx: number, cy: number, g: NodeGeom, state: NodeStatus, hubR: number): void {
  const rEnd = g.rL4Hole * 0.98;
  const glow = state === 'LOCKED' ? COLOR.green : state === 'ALERT' ? COLOR.magenta : null;

  ctx.save();
  // 斜桁架（每根沿对角方向施以中心偏移，同时服务 4 根 X 交叉）
  L3_BEAM_ANGLES.forEach((a) => {
    const [x1, y1] = ellipsePoint(cx, cy, hubR, hubR * K_Y, a);
    const [x2, y2] = ellipsePoint(cx, cy, rEnd, rEnd * K_Y, a);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = COLOR.trussDark;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // 高光棱线 0.5px
    ctx.beginPath();
    ctx.moveTo(x1, y1 - 0.25);
    ctx.lineTo(x2, y2 - 0.25);
    ctx.strokeStyle = rgba(COLOR.trussHighlight, 0.9);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // LOCKED 嵌光 / ALERT 警示光
    if (glow) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = rgba(glow, 0.9);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  });

  // 支撑方柱：0.8×0.8，顶面提亮
  L3_PILLAR_ANGLES.forEach((a) => {
    const [px, py] = ellipsePoint(cx, cy, rEnd * 0.82, rEnd * K_Y * 0.82, a);
    ctx.fillStyle = COLOR.trussTop;
    ctx.fillRect(snap(px - 0.4), snap(py - 0.4), 0.8, 0.8);
    ctx.strokeStyle = COLOR.trussDark;
    ctx.lineWidth = 0.4;
    ctx.strokeRect(snap(px - 0.4), snap(py - 0.4), 0.8, 0.8);
  });
  ctx.restore();
}

/* ================================ L4 装甲壳（§3.2 L4） ================================ */
interface ArmorSeg {
  center: number; // 中心角（度）
  span: number; // 跨度（度）
  isMain: boolean;
}

/** 4 段装甲精确角度：Seg0 主 135°/105°，Seg1 副 45°/65°，Seg2 主 315°/105°，Seg3 副 225°/65° */
const L4_SEGS: ArmorSeg[] = [
  { center: 135, span: 105, isMain: true },
  { center: 45, span: 65, isMain: false },
  { center: 315, span: 105, isMain: true },
  { center: 225, span: 65, isMain: false },
];

/** 搭接压盖顺序：Seg1 -> Seg2 -> Seg3 -> Seg0 最终覆盖 */
const L4_CLOSE_ORDER = [1, 2, 3, 0];

/** STAGED 2.5D 深度重排序：最远端先画（Seg2 -> Seg1 -> Seg3 -> Seg0），由 drawL4Staged 消费 */
const L4_STAGED_ORDER = [2, 1, 3, 0];

/** STAGED 差速开壳时序（总基准 500ms）：主装甲 0~350ms 翻至 25°；副装甲延迟 120ms、120~500ms 翻至 15° */
const L4_STAGED_TIMING = { mainStart: 0, mainEnd: 350, mainAngle: 25, subStart: 120, subEnd: 500, subAngle: 15 };
const L4_STAGED_TOTAL_MS = 500;

const L4_SHELL_TOP = '#2D333B';
const L4_SHELL_BOTTOM = '#1A1F26';

/**
 * 单段装甲瓦绘制
 * @param flip 抬升翻转角（度，0 为闭合平铺）
 * @param centerOverride 覆盖该段的方位中心角（度）。STAGED 开壳贴片传 0，
 *        使其成为「方位中立」的单段模板，与 §6.2 消费端 drawRotatedSprite 的旋转约定配套
 *        （与 L1 单段 52° 模板同一约定：贴片烘焙在 0°，方位由运行时旋转决定）
 */
function drawArmorSeg(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  g: NodeGeom,
  seg: ArmorSeg,
  flip: number,
  gapDeg: number,
  lockedEdge: boolean,
  centerOverride?: number
): void {
  const half = (seg.span - gapDeg) * DEG * 0.5;
  const midA = (centerOverride ?? seg.center) * DEG;
  const a0 = midA - half;
  const a1 = midA + half;
  const rOuter = g.rOuter;
  const rInner = g.rL4Hole;

  // 翻转可视化：外缘沿段中心方向外移，抬高外沿以呈现掀开感
  const dirX = Math.cos(midA);
  const dirY = Math.sin(midA) * K_Y;
  const lift = flip * 0.06;

  ctx.save();
  const grad = ctx.createLinearGradient(
    cx - rOuter * 0.6,
    cy - rOuter * K_Y * 0.6,
    cx + rOuter * 0.6,
    cy + rOuter * K_Y * 0.6
  );
  grad.addColorStop(0, L4_SHELL_TOP);
  grad.addColorStop(1, L4_SHELL_BOTTOM);

  ellipseRingPath(ctx, cx, cy, rOuter + lift * 2, rInner, a0, a1);
  ctx.fillStyle = grad;
  ctx.fill();

  // 外缘轮廓 + 左上光源明暗描边
  ctx.strokeStyle = rgba('#6E7681', 0.85 * lightFactor((a0 + a1) / 2));
  ctx.lineWidth = lockedEdge ? 0.9 : 0.6;
  ellipseArcPath(ctx, cx, cy, rOuter + lift * 2, (rOuter + lift * 2) * K_Y, a0, a1);
  ctx.stroke();

  // 内缘阶梯搭接线
  ctx.strokeStyle = rgba('#0D1117', 0.95);
  ctx.lineWidth = 0.6;
  ellipseArcPath(ctx, cx, cy, rInner, rInner * K_Y, a0, a1);
  ctx.stroke();

  // 迎光面高光棱线（仅主装甲）
  if (seg.isMain) {
    ctx.strokeStyle = rgba('#C9D1D9', 0.35);
    ctx.lineWidth = 0.5;
    ellipseArcPath(ctx, cx, cy, rOuter * 0.88 + lift * 2, (rOuter * 0.88 + lift * 2) * K_Y, a0 + 0.06, a1 - 0.06);
    ctx.stroke();
  }

  // LOCKED 锁死线：内沿嵌高光
  if (lockedEdge) {
    ctx.shadowColor = rgba(COLOR.green, 0.8);
    ctx.shadowBlur = 1.6;
    ctx.strokeStyle = rgba(COLOR.green, 0.9);
    ctx.lineWidth = 0.7;
    ellipseArcPath(ctx, cx, cy, rInner + 0.45, (rInner + 0.45) * K_Y, a0, a1);
    ctx.stroke();
  }

  // 抬升段的投影残余（STAGED）
  if (flip > 0) {
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(cx + dirX * rInner, cy + dirY * rInner);
    ctx.lineTo(cx + dirX * (rOuter + lift * 2), cy + dirY * (rOuter + lift * 2));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** L4 闭合态（STABLE / LOCKED / ALERT）整壳 */
function drawL4Closed(ctx: CanvasRenderingContext2D, cx: number, cy: number, g: NodeGeom, state: NodeStatus): void {
  const locked = state === 'LOCKED';
  const gapDeg = locked ? 5 - 4.7 : 5; // LOCKED 间隙收紧至 0.3px 等效角
  L4_CLOSE_ORDER.forEach((idx) => {
    const seg = L4_SEGS[idx];
    drawArmorSeg(ctx, cx, cy, g, seg, 0, gapDeg, locked);
  });
  // ALERT：装甲外沿品红警示描边
  if (state === 'ALERT') {
    ctx.save();
    ctx.strokeStyle = rgba(COLOR.magenta, 0.55);
    ctx.lineWidth = 0.6;
    ellipseArcPath(ctx, cx, cy, g.rOuter + 0.4, (g.rOuter + 0.4) * K_Y, 0, Math.PI * 2, 72);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * L4 STAGED 开壳绘制：按 2.5D 深度重排序（L4_STAGED_ORDER: 2→1→3→0）逐段绘制
 * 时序：主装甲 0~350ms 翻至 25°；副装甲延迟 120ms、120~500ms 翻至 15°
 * @param elapsedMs 距开壳起点的毫秒数（>=500 即最终定格形态）
 */
function drawL4Staged(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  g: NodeGeom,
  elapsedMs: number,
  group: 'both' | 'main' | 'sub' = 'both'
): void {
  const t = Math.min(elapsedMs, L4_STAGED_TOTAL_MS);
  L4_STAGED_ORDER.forEach((idx) => {
    const seg = L4_SEGS[idx];
    if (group === 'main' && !seg.isMain) return;
    if (group === 'sub' && seg.isMain) return;
    // 主装甲（Seg0/Seg2）与副装甲（Seg1/Seg3）走各自的延迟与目标角
    const start = seg.isMain ? L4_STAGED_TIMING.mainStart : L4_STAGED_TIMING.subStart;
    const end = seg.isMain ? L4_STAGED_TIMING.mainEnd : L4_STAGED_TIMING.subEnd;
    const targetAngle = seg.isMain ? L4_STAGED_TIMING.mainAngle : L4_STAGED_TIMING.subAngle;
    const progress = t <= start ? 0 : Math.min(1, (t - start) / (end - start));
    // centerOverride = 0：开壳贴片烘焙为方位中立的单段模板，实际方位由消费端旋转到 seg.angle
    drawArmorSeg(ctx, cx, cy, g, seg, targetAngle * progress, 5, false, 0);
  });
}

/* ================================ L5 活性环（§3.2 L5） ================================ */
/** 8 档离散组合参数表（方案 C）：segCount / totalSpan / startAngle */
const L5_QUANT_TABLE: { segCount: number; totalSpan: number; startAngle: number }[] = [
  { segCount: 3, totalSpan: 90, startAngle: 135 }, // q0 极弱 -120~-110 dBm
  { segCount: 3, totalSpan: 150, startAngle: 105 }, // q1 弱   -110~-100
  { segCount: 3, totalSpan: 210, startAngle: 75 }, // q2 偏弱  -100~-90
  { segCount: 4, totalSpan: 180, startAngle: 90 }, // q3 中等   -90~-80
  { segCount: 4, totalSpan: 240, startAngle: 60 }, // q4 良好   -80~-70
  { segCount: 4, totalSpan: 270, startAngle: 45 }, // q5 优良   -70~-60
  { segCount: 5, totalSpan: 300, startAngle: 30 }, // q6 强     -60~-50
  { segCount: 5, totalSpan: 330, startAngle: 15 }, // q7 满载   -50~-40
];

/** L5 参数：每段 45° + 间隙 15° 步进 */
const L5_SEG_SPAN = 45;
const L5_SEG_GAP = 15;

/** 按档位绘制 L5 短弧点阵（半径 R_L5 = R_L4_hole * 0.90，厚度 0.5px） */
function drawL5Quant(ctx: CanvasRenderingContext2D, cx: number, cy: number, rL5: number, qIndex: number, color: string): void {
  const q = L5_QUANT_TABLE[qIndex];
  const step = L5_SEG_SPAN + L5_SEG_GAP;
  ctx.save();
  for (let s = 0; s < q.segCount; s++) {
    const a0 = (q.startAngle + s * step) * DEG;
    const a1 = a0 + L5_SEG_SPAN * DEG;
    const midA = (a0 + a1) / 2;
    ellipseArcPath(ctx, cx, cy, rL5, rL5 * K_Y, a0, a1, 12);
    ctx.strokeStyle = rgba(color, Math.max(0.25, 0.95 * lightFactor(midA)));
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // 短弧端点点阵（脉冲感）
    const [ex, ey] = ellipsePoint(cx, cy, rL5, rL5 * K_Y, a0);
    ctx.beginPath();
    ctx.arc(ex, ey, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 0.95);
    ctx.fill();
  }
  ctx.restore();
}

/** L5 动态单段模板（45°） */
function drawL5Segment(ctx: CanvasRenderingContext2D, cx: number, cy: number, rL5: number, color: string): void {
  ctx.save();
  ellipseArcPath(ctx, cx, cy, rL5, rL5 * K_Y, -22.5 * DEG, 22.5 * DEG, 14);
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.restore();
}

/* ================================ L6 核心反应舱（§3.2 L6） ================================ */
/** L4 井口透视下沉量（px） */
const L6_SINK_DY = 1.64;

/**
 * 外层多面体几何壳（R_L6 = R_L4_hole * 0.92）+ 井口 1.5px 内阴影
 * 内层脉冲光斑由 Canvas 实时绘制，不在本 Sprite 内
 */
function drawL6Shell(ctx: CanvasRenderingContext2D, cx: number, cy: number, g: NodeGeom, state: NodeStatus): void {
  const cyShell = cy + L6_SINK_DY; // 透视下沉
  const rL6 = g.rL6;
  const verts = 6; // 多面体壳：六边形底面
  ctx.save();

  // 井口内壁 1.5px 渐变内阴影
  const wellGrad = ctx.createRadialGradient(cx, cyShell, rL6 * 0.2, cx, cyShell, g.rL4Hole * 1.05);
  wellGrad.addColorStop(0, 'rgba(0, 0, 0, 0.20)');
  wellGrad.addColorStop(1, 'rgba(0, 0, 0, 0.70)');
  ctx.beginPath();
  ctx.ellipse(cx, cyShell, g.rL4Hole * 1.02, g.rL4Hole * 1.02 * K_Y, 0, 0, Math.PI * 2);
  ctx.fillStyle = wellGrad;
  ctx.fill();

  // 多面体外壳轮廓
  ctx.beginPath();
  for (let i = 0; i <= verts; i++) {
    const a = (i / verts) * Math.PI * 2;
    const [x, y] = ellipsePoint(cx, cyShell, rL6, rL6 * K_Y, a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const shellGrad = ctx.createLinearGradient(cx - rL6, cyShell - rL6 * K_Y, cx + rL6, cyShell + rL6 * K_Y);
  shellGrad.addColorStop(0, '#2D333B');
  shellGrad.addColorStop(1, '#12161B');
  ctx.fillStyle = shellGrad;
  ctx.fill();
  ctx.strokeStyle = rgba(stateColor(state), 0.7);
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // 棱面分割线（多面体感）
  ctx.strokeStyle = rgba('#6E7681', 0.28);
  ctx.lineWidth = 0.4;
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * Math.PI * 2;
    const [x, y] = ellipsePoint(cx, cyShell, rL6, rL6 * K_Y, a);
    ctx.beginPath();
    ctx.moveTo(cx, cyShell);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}

/* ================================ L7 铭刻基底层（§3.2 L7） ================================ */
/** 3×3 状态微缩点阵（HUB / RELAY） */
function drawL7Matrix(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  const pitch = 2.2;
  ctx.save();
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      ctx.beginPath();
      ctx.arc(cx + col * pitch, cy + row * pitch * K_Y, 0.5, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, 0.9);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 罗盘十字标线（PROBE / SCANNER） */
function drawL7Compass(ctx: CanvasRenderingContext2D, cx: number, cy: number, g: NodeGeom, color: string): void {
  const r = g.rL4Hole * 0.72;
  ctx.save();
  // 椭圆罗盘环
  ctx.strokeStyle = rgba(color, 0.75);
  ctx.lineWidth = 0.5;
  ellipseArcPath(ctx, cx, cy, r, r * K_Y, 0, Math.PI * 2, 48);
  ctx.stroke();
  // 十字标线
  const [lx1, ly1] = ellipsePoint(cx, cy, r, r * K_Y, Math.PI);
  const [lx2, ly2] = ellipsePoint(cx, cy, r, r * K_Y, 0);
  const [ty1, ty2] = [cy - r * K_Y, cy + r * K_Y];
  ctx.beginPath();
  ctx.moveTo(lx1, ly1);
  ctx.lineTo(lx2, ly2);
  ctx.moveTo(cx, ty1);
  ctx.lineTo(cx, ty2);
  ctx.strokeStyle = rgba(color, 0.6);
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // 四向刻度
  [0, 90, 180, 270].forEach((d) => {
    const [x1, y1] = ellipsePoint(cx, cy, r * 0.86, r * K_Y * 0.86, d * DEG);
    const [x2, y2] = ellipsePoint(cx, cy, r * 1.06, r * K_Y * 1.06, d * DEG);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = 0.5;
    ctx.stroke();
  });
  ctx.restore();
}

/* ================================ FX 粒子（§4.1 FX） ================================ */
/** 确定性伪随机：避免 Math.random 破坏图集稳定性 */
function pseudo01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type FxKind = 'cyan' | 'amber' | 'magenta' | 'glow' | 'debris';

/** 五种粒子贴片：软光点三类 + 发光核 + 碎片 */
function drawFxParticle(ctx: CanvasRenderingContext2D, cx: number, cy: number, kind: FxKind): void {
  const baseColor =
    kind === 'cyan' ? COLOR.cyan
    : kind === 'amber' ? COLOR.amber
    : kind === 'magenta' ? COLOR.magenta
    : kind === 'glow' ? '#E6FFFA'
    : '#8B949E';

  ctx.save();
  if (kind === 'debris') {
    // 碎片：不规则四边形硬边
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + pseudo01(i + 1) * 0.7;
      const r = 1.4 + pseudo01(i + 7) * 1.6;
      const [x, y] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r * K_Y];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(baseColor, 0.75);
    ctx.fill();
    ctx.strokeStyle = rgba('#FFFFFF', 0.35);
    ctx.lineWidth = 0.4;
    ctx.stroke();
  } else if (kind === 'glow') {
    // 发光核：中心白核 + 青色外晕
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 3.2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.35, rgba(COLOR.cyan, 0.55));
    grad.addColorStop(1, rgba(COLOR.cyan, 0));
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    // 软光点（cyan / amber / magenta）
    const grad = ctx.createRadialGradient(cx - 0.6, cy - 0.6, 0, cx, cy, 2.4);
    grad.addColorStop(0, rgba(baseColor, 0.95));
    grad.addColorStop(0.5, rgba(baseColor, 0.45));
    grad.addColorStop(1, rgba(baseColor, 0));
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.restore();
}

/* ================================ 图集构建主入口（§4.2） ================================ */

/**
 * 2.5D 异构 Sprite 工厂构建主入口
 * @param dpr 设备像素比（强制上限 2.0）
 * @returns 包含 106 条预渲染 Sprite 的不可变图集对象
 */
export function buildNodeSpriteSheet(dpr?: number): NodeSpriteSheet {
  const ratio = Math.min(dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1), 2.0);
  const store = new Map<string, SpriteEntry>();

  /** 统一登记：以画布中心为节点锚点，正方形画布保证各向留白一致 */
  const register = (key: string, size: number, draw: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void): void => {
    const s = Math.ceil(size);
    const { canvas, ctx } = createCanvas(s, ratio);
    const c = s / 2;
    draw(ctx, c, c);
    spriteKeyByCanvas.set(canvas, key);
    store.set(key, { canvas, width: s, height: s, anchorX: c, anchorY: c });
  };

  ALL_TYPES.forEach((type) => {
    const g = GEOM[type];

    /* ---------- L1 护盾层：4 类型 × 4 状态 × 1 段模板 = 16 条 ---------- */
    ALL_STATES.forEach((state) => {
      register(`L1_${type}_${state}_seg`, 2 * g.rL1Outer + 12, (ctx, cx, cy) => {
        drawL1Segment(ctx, cx, cy, g, state);
      });
    });

    /* ---------- L2 珠链层：4 条导轨 ---------- */
    register(`L2_${type}_ALL_rail`, 2 * g.rL2 + 16, (ctx, cx, cy) => {
      drawL2Rail(ctx, cx, cy, g);
    });

    /* ---------- L3 桁架层：1 条常显中心盘 + 3 条全开网架 = 每类型 4 条 ---------- */
    register(`L3_${type}_STABLE_hub`, 2 * g.rL3Hub + 10, (ctx, cx, cy) => {
      drawL3Hub(ctx, cx, cy, g.rL3Hub, null);
    });
    (['STAGED', 'LOCKED', 'ALERT'] as NodeStatus[]).forEach((state) => {
      register(`L3_${type}_${state}_truss`, 2 * g.rL4Hole + 10, (ctx, cx, cy) => {
        drawL3Truss(ctx, cx, cy, g, state, g.rL3Hub);
      });
    });

    /* ---------- L4 装甲壳：3 条闭合态 + 2 条开壳态 = 每类型 5 条 ---------- */
    (['STABLE', 'LOCKED', 'ALERT'] as NodeStatus[]).forEach((state) => {
      register(`L4_${type}_${state}_base`, 2 * g.rOuter + 18, (ctx, cx, cy) => {
        drawL4Closed(ctx, cx, cy, g, state);
      });
    });
    // 开壳态两张贴片：按 L4_STAGED_ORDER 深度重排序 + 差速时序，分别只画主装甲组 / 副装甲组
    // （elapsedMs 取总时长 500ms，即开壳完成的定格形态）
    register(`L4_${type}_STAGED_segMain`, 2 * g.rOuter + 18, (ctx, cx, cy) => {
      drawL4Staged(ctx, cx, cy, g, L4_STAGED_TOTAL_MS, 'main');
    });
    register(`L4_${type}_STAGED_segSub`, 2 * g.rOuter + 18, (ctx, cx, cy) => {
      drawL4Staged(ctx, cx, cy, g, L4_STAGED_TOTAL_MS, 'sub');
    });

    /* ---------- L6 内核壳：4 状态 = 每类型 4 条 ---------- */
    ALL_STATES.forEach((state) => {
      register(`L6_${type}_${state}_shell`, 2 * g.rOuter + 14, (ctx, cx, cy) => {
        drawL6Shell(ctx, cx, cy, g, state);
      });
    });

    /* ---------- L7 铭刻：4 状态 = 每类型 4 条 ---------- */
    ALL_STATES.forEach((state) => {
      register(`L7_${type}_${state}_base`, 2 * g.rOuter + 10, (ctx, cx, cy) => {
        const color = state === 'LOCKED' ? COLOR.insigniaLocked : COLOR.insignia;
        if (type === 'HUB' || type === 'RELAY') drawL7Matrix(ctx, cx, cy, color);
        else drawL7Compass(ctx, cx, cy, g, color);
      });
    });
  });

  /* ---------- L2 通用珠与投影：4 条 ---------- */
  register('L2_ALL_ALL_bead_off', 10, (ctx, cx, cy) => {
    drawL2Bead(ctx, cx, cy, 1.0, COLOR.beadOff, false);
  });
  register('L2_ALL_ALL_bead_on_cyan', 10, (ctx, cx, cy) => {
    drawL2Bead(ctx, cx, cy, 1.0, COLOR.cyan, true);
  });
  register('L2_ALL_ALL_bead_on_green', 10, (ctx, cx, cy) => {
    drawL2Bead(ctx, cx, cy, 1.0, COLOR.green, true);
  });
  register('L2_ALL_ALL_shadow', 10, (ctx, cx, cy) => {
    drawL2Shadow(ctx, cx, cy, 1.0);
  });

  /* ---------- L5 活性环：8 档 LOCKED 贴片 + 1 条动态段模板 = 9 条 ---------- */
  for (let q = 0; q < 8; q++) {
    const geom = GEOM.RELAY;
    register(`L5_ALL_LOCKED_q${q}`, 2 * geom.rL5 + 10, (ctx, cx, cy) => {
      drawL5Quant(ctx, cx, cy, geom.rL5, q, COLOR.green);
    });
  }
  register('L5_ALL_ACTIVE_seg', 2 * GEOM.RELAY.rL5 + 10, (ctx, cx, cy) => {
    drawL5Segment(ctx, cx, cy, GEOM.RELAY.rL5, COLOR.cyan);
  });

  /* ---------- FX 粒子：5 条 ---------- */
  (['cyan', 'amber', 'magenta', 'glow', 'debris'] as FxKind[]).forEach((kind) => {
    register(`FX_PARTICLE_ALL_${kind}`, 14, (ctx, cx, cy) => {
      drawFxParticle(ctx, cx, cy, kind);
    });
  });

  /* ---------- 冻结返回：只读图集对象 ---------- */
  const sheet: NodeSpriteSheet = {
    get: (key: string) => store.get(key),
    has: (key: string) => store.has(key),
    totalCount: store.size,
  };
  return Object.freeze(sheet);
}
