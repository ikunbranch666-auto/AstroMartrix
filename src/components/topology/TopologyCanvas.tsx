import React, { useRef, useEffect } from 'react';
import { RelayNode, TopologyEdge, NodeType } from '../../types/domain';
import { FSMPhase } from '../../types/fsm';
import { NodeSpriteSheet, SpriteEntry, buildNodeSpriteSheet } from '../../core/nodeSpriteFactory';
import { createParticlePool, ParticlePool } from '../../core/particlePool';
import { MatrixEngine } from '../../engine/MatrixEngine';
import { computeSpringInterpolation } from '../../engine/springPhysics';
import { useCanvasDPR } from '../../hooks/useCanvasDPR';

/* ==========================================================================================
 * AstroMatrix · 空间中继拓扑画布（节点本体 2.5D 重做）
 *
 * 渲染管线分为两条：
 *   1. 静态节点（59 个）：全部走 sprite 图集 blit（§3.2 七层异构皮肤）
 *   2. 活跃节点（选中/拖拽）：同样走 sprite blit，但额外叠加实时管线
 *      （L4 差速开壳、L5 实时短弧、L1 ALERT 涟漪、L6 光斑调制、4 级视差）
 *
 * 坐标系：
 *   - 世界坐标：节点 coords 为百分比（0-100），映射基准 DESIGN_W x DESIGN_H
 *   - 屏幕坐标：CSS 像素，= 世界像素 x scale + offset
 *   - 视口变换由 renderFrame 统一应用；视差为世界坐标内的视觉浮动，随视口一同缩放
 * ========================================================================================== */

export interface TopologyCanvasProps {
  nodes: Record<string, RelayNode>;
  edges: TopologyEdge[];
  selectedNodeId: string | null;
  phase: FSMPhase;
  /**
   * FSM 的推演目标坐标（世界百分比）。锚点语义的唯一真值源：
   * STAGE1/STAGE2 期间节点停在 targetCoords；COMMITTED 后 App 会把它写入 node.coords。
   */
  targetCoords: [number, number] | null;
  onSelectNode: (nodeId: string) => void;
  /** 拖拽上报：跨过 5px 阈值时首次调用，其后每次 pointerMove 都调用（坐标单位：世界百分比 0-100） */
  onDragNode: (nodeId: string, x: number, y: number) => void;
  /** STAGE1 -> STAGE2：由 handlePointerUp 在「位移 ≥ 15% 画布宽度」时调用 */
  onEnterDecisionStage: () => void;
  /** STAGE1/STAGE2 -> AUTO_ABORT：由 handlePointerUp 在「位移不足」时调用 */
  onAbortDecision: () => void;
}

/* ================================ 辅助纯函数（§6.1 契约） ================================ */

/**
 * 获取对应节点类型的基准长半轴半径（像素）
 * 严格对齐 PRD v1.8 §5.5 规范
 */
export function getNodeRadius(type: NodeType): number {
  switch (type) {
    case 'HUB': return 8.0;
    case 'RELAY': return 7.0;
    case 'SCANNER': return 6.0;
    case 'PROBE': return 5.0;
    default: return 7.0;
  }
}

/**
 * 静态贴片直接 blit 辅助函数
 * 自动根据 SpriteEntry 锚点居中绘制
 */
export function drawStaticSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteEntry | undefined,
  offsetX = 0,
  offsetY = 0
): void {
  if (!sprite) return;
  ctx.drawImage(sprite.canvas, offsetX - sprite.anchorX, offsetY - sprite.anchorY);
}

/**
 * 旋转贴片 blit 辅助函数
 * 以当前原点为旋转中心，按 angleDeg 角度旋转后居中 blit，绘制后还原上下文
 */
export function drawRotatedSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteEntry | undefined,
  angleDeg: number,
  offsetX = 0,
  offsetY = 0
): void {
  if (!sprite) return;
  const rad = (angleDeg * Math.PI) / 180;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.rotate(rad);
  ctx.drawImage(sprite.canvas, -sprite.anchorX, -sprite.anchorY);
  ctx.restore();
}

/* ================================ 拖拽四级视差状态（§6.3） ================================ */
/**
 * 四级视差坐标（模块级单例，因画布同时只存在一个活跃拖拽节点）
 * lambda：pL7 1.00（质心先导）/ pL6 0.98 / pL4 0.96 / pL1 0.94
 * 单位为「世界像素」，随视口一同缩放，保证层间分离关系在任何倍率下一致。
 */
const parallaxState = {
  pL7: { x: 0, y: 0 },
  pL6: { x: 0, y: 0 },
  pL4: { x: 0, y: 0 },
  pL1: { x: 0, y: 0 },
};

/* ================================ 视口（缩放 / 平移） ================================ */
/**
 * 世界坐标系说明：节点 coords 为百分比（0-100），映射到画布时的基准像素为
 * DESIGN_W x DESIGN_H。视口在此基准上做几何缩放与平移。
 */
const DESIGN_W = 1528;
const DESIGN_H = 492;
/** 缩放范围与初始倍率（初始放大以便直接看到 2.5D 异构结构） */
const MIN_SCALE = 0.5;
const MAX_SCALE = 15;
const INITIAL_SCALE = 3;
/** 滚轮灵敏度（连续缩放系数 = exp(-deltaY * WHEEL_SENSITIVITY)） */
const WHEEL_SENSITIVITY = 0.0015;

const clampScale = (v: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

/** 世界百分比坐标 -> 世界像素坐标 */
const worldToPx = (wx: number, wy: number): { x: number; y: number } => ({
  x: (wx / 100) * DESIGN_W,
  y: (wy / 100) * DESIGN_H,
});

/**
 * 屏幕（CSS 像素）坐标 -> 世界百分比坐标（命中检测 / 拖拽派发共用）
 * 逆变换：world = (screen - offset) / scale
 */
function screenToWorld(
  sx: number,
  sy: number,
  vp: { scale: number; offsetX: number; offsetY: number }
): { x: number; y: number } {
  const bx = (sx - vp.offsetX) / vp.scale;
  const by = (sy - vp.offsetY) / vp.scale;
  return { x: (bx / DESIGN_W) * 100, y: (by / DESIGN_H) * 100 };
}

/* ---------- 活跃节点锚点派生（节点本体与连线共用同一条真值链） ---------- */

/**
 * 派生「活跃节点」当前应处的世界百分比坐标。
 *
 * 这是节点绘制与连线端点唯一的共享真值来源，避免两处各自内联推导导致不一致
 * （曾出现：节点停在落点、连线却连回原位的割裂）。
 *
 * 语义：
 *   STABLE_IDLE / COMMITTED : node.coords（COMMITTED 时 App 已把 targetCoords 写入其中）
 *   STAGE1 / STAGE2         : 拖拽中取指针世界坐标；松手后停在 targetCoords
 *   AUTO_ABORT              : 由 targetCoords 以 1.2s 阻尼弹簧回弹到 node.coords（连线同步跟随）
 */
function deriveActiveAnchor(
  node: RelayNode,
  phase: FSMPhase,
  dragWorld: { x: number; y: number } | null,
  targetCoords: [number, number] | null,
  reboundStart: { time: number; x: number; y: number } | null,
  now: number
): [number, number] {
  const baseX = node.coords[0];
  const baseY = node.coords[1];

  if (phase === 'AUTO_ABORT') {
    if (reboundStart) {
      const elapsed = (now - reboundStart.time) / 1000;
      const spring = computeSpringInterpolation(
        { x: reboundStart.x, y: reboundStart.y },
        { x: baseX, y: baseY },
        elapsed
      );
      return [spring.x, spring.y];
    }
    return [baseX, baseY];
  }

  if (phase === 'STAGE1_SIMULATION' || phase === 'STAGE2_DECISION') {
    if (dragWorld) return [dragWorld.x, dragWorld.y];
    if (targetCoords) return targetCoords;
  }

  return [baseX, baseY];
}

/* ---------- 边绘制辅助（模块级预分配，零逐帧分配） ---------- */

/** 空虚线模板：复位 setLineDash 用（预分配，避免每次传新数组） */
const EMPTY_DASH: number[] = [];
/** 虚拟推演边虚线模板：[6, 6] */
const VIRTUAL_DASH: number[] = [6, 6];

/**
 * 追加一条端点内缩的线段到当前路径（不 stroke，由调用方批量 stroke）
 * 端点终止于 L2 轨道环外缘：两侧分别沿连线方向内缩 insetFrom / insetTo
 * 入参为世界百分比坐标，故拖拽中的节点可由调用方传入指针位置，实现连线跟随
 */
function appendInsetSegment(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  insetFrom: number,
  insetTo: number
): void {
  const p1 = worldToPx(from.x, from.y);
  const p2 = worldToPx(to.x, to.y);
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= insetFrom + insetTo) return; // 两节点过近，内缩后无有效线段
  const ux = dx / len;
  const uy = dy / len;
  ctx.moveTo(x1 + ux * insetFrom, y1 + uy * insetFrom);
  ctx.lineTo(x2 - ux * insetTo, y2 - uy * insetTo);
}

/** 拓扑连线绘制（142 条，极简：无装饰、无发光、无动画） */
function drawTopologyEdges(
  ctx: CanvasRenderingContext2D,
  edges: TopologyEdge[],
  nodes: Record<string, RelayNode>,
  viewScale: number,
  selectedNodeId: string | null,
  phase: FSMPhase,
  dragWorld: { x: number; y: number } | null,
  targetCoords: [number, number] | null,
  reboundStart: { time: number; x: number; y: number } | null,
  now: number
): void {
  // 线宽屏幕自适应：世界线宽 × scale，放大后不压过节点细节（同时保证缩小时不至于细到消失）
  const lw = (base: number): number => Math.max(0.35, base / viewScale);

  /**
   * 端点世界坐标。与 drawActiveNode 共用 deriveActiveAnchor，保证连线与节点永远同步：
   *   - 仅「当前活跃节点」且 phase 非稳态/非固化时走派生锚点（含拖拽、决断停留、熔断回弹）
   *   - 其余 59 个节点始终用自身 node.coords
   */
  const endpointOf = (node: RelayNode): { x: number; y: number } => {
    if (node.id === selectedNodeId && phase !== 'STABLE_IDLE' && phase !== 'COMMITTED') {
      const [ax, ay] = deriveActiveAnchor(node, phase, dragWorld, targetCoords, reboundStart, now);
      return { x: ax, y: ay };
    }
    return { x: node.coords[0], y: node.coords[1] };
  };

  // 1. 常规边（bandwidth < 0.8）：1px / rgba(0,240,255,0.18)
  ctx.save();
  ctx.setLineDash(EMPTY_DASH);
  ctx.lineWidth = lw(1);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
  ctx.beginPath();

  // 2. 主干边（bandwidth >= 0.8）：单独一批，1.5px / alpha 提高至 0.35
  //    批次分离的原因：线宽与颜色不同，无法与常规边共用同一次 stroke
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (edge.isVirtual) continue; // 虚拟推演边走琥珀虚线通道
    if (edge.bandwidth >= 0.8) continue;
    const from = nodes[edge.source];
    const to = nodes[edge.target];
    if (!from || !to) continue;
    const insetFrom = getNodeRadius(from.type) * 0.95; // 端点内缩至 L2 轨道环外缘
    const insetTo = getNodeRadius(to.type) * 0.95;
    appendInsetSegment(ctx, endpointOf(from), endpointOf(to), insetFrom, insetTo);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = lw(1.5);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (edge.isVirtual) continue;
    if (edge.bandwidth < 0.8) continue;
    const from = nodes[edge.source];
    const to = nodes[edge.target];
    if (!from || !to) continue;
    const insetFrom = getNodeRadius(from.type) * 0.95;
    const insetTo = getNodeRadius(to.type) * 0.95;
    appendInsetSegment(ctx, endpointOf(from), endpointOf(to), insetFrom, insetTo);
  }
  ctx.stroke();

  // 3. 虚拟推演边（isVirtual）：琥珀 #F59E0B 虚线
  ctx.beginPath();
  ctx.lineWidth = lw(1.5);
  ctx.strokeStyle = '#F59E0B';
  ctx.setLineDash(VIRTUAL_DASH);
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge.isVirtual) continue;
    const from = nodes[edge.source];
    const to = nodes[edge.target];
    if (!from || !to) continue;
    const insetFrom = getNodeRadius(from.type) * 0.95;
    const insetTo = getNodeRadius(to.type) * 0.95;
    appendInsetSegment(ctx, endpointOf(from), endpointOf(to), insetFrom, insetTo);
  }
  ctx.stroke();
  ctx.restore();
}

/** 粒子类型 -> FX 贴片 key 映射（下标即 ParticleType 数值） */
const FX_SPRITE_KEYS = [
  'FX_PARTICLE_ALL_cyan',
  'FX_PARTICLE_ALL_amber',
  'FX_PARTICLE_ALL_magenta',
  'FX_PARTICLE_ALL_glow',
  'FX_PARTICLE_ALL_debris',
];

/** 粒子 blit（Tier3 跳过由外层 renderFrame 统一判断） */
function drawParticles(
  ctx: CanvasRenderingContext2D,
  particlePool: ParticlePool,
  spriteSheet: NodeSpriteSheet
): void {
  // 1. 取零 GC 紧凑渲染数据：[x, y, alpha, type, ...]
  const { count, data } = particlePool.getRenderData();
  if (count === 0) return;

  ctx.save();
  // 2. 逐颗 blit：每颗粒子 4 个字段
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x = data[o];
    const y = data[o + 1];
    const alpha = data[o + 2];
    const type = data[o + 3];
    const key = FX_SPRITE_KEYS[type] ?? FX_SPRITE_KEYS[0];
    const sprite = spriteSheet.get(key);
    if (!sprite) continue;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite.canvas, x - sprite.anchorX, y - sprite.anchorY);
  }
  // 3. 循环结束恢复全局透明度，避免污染后续绘制
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

/* ---------- §7 数据映射与异常分级 ---------- */

export interface NodeVisualParams {
  activeTicks: number;
  l5ArcAngle: number;
  quantizedArcIndex: number;
  activeSegmentCount: number;
  coreAlpha: number;
  angularVelocity: number;
  seamWidth: number;
  seamAlpha: number;
}

/**
 * 四通道物理遥测 -> 视觉参数映射（施工文档 §7 完整实现）
 * 通道1 L2 刻度珠点亮数 / 通道2 L5 脉冲短弧 / 通道3 L6 核心发光 / 通道4 L2 公转转速
 * 【导出】供 App.tsx 在 COMMITTED 时构造 LockedSnapshot 复用同一套公式
 */
export function computeNodeVisualParams(node: RelayNode, time: number): NodeVisualParams {
  // 1. 通道 1: L2 刻度珠点亮数 (0..12)
  const activeTicks =
    node.status === 'LOCKED'
      ? node.lockedSnapshot?.connectionCount ?? node.connectionCount
      : Math.min(12, Math.max(0, node.connectionCount));

  // 2. 通道 2: L5 脉冲短弧激活段数 (3..5) 与总跨度
  let l5ArcAngle: number;
  let quantizedArcIndex: number;
  let activeSegmentCount: number;

  if (node.status === 'LOCKED' && node.lockedSnapshot) {
    l5ArcAngle = node.lockedSnapshot.arcLength;
    quantizedArcIndex = node.lockedSnapshot.quantizedArcIndex;
    activeSegmentCount = 3 + Math.floor((quantizedArcIndex / 7) * 2);
  } else {
    const normSignal = Math.max(0, Math.min(1, (node.signalPower + 120) / 80));
    l5ArcAngle = (30 + normSignal * 300) * (Math.PI / 180);
    quantizedArcIndex = Math.min(7, Math.floor(normSignal * 8));
    activeSegmentCount = 3 + Math.floor(normSignal * 2.99); // 3, 4, 5 段
  }

  // 3. 通道 3: L6 核心发光与脉冲光斑
  let coreAlpha: number;
  if (node.status === 'LOCKED' && node.lockedSnapshot) {
    coreAlpha = node.lockedSnapshot.coreAlpha;
  } else {
    const breathBase = 0.775 + 0.225 * Math.sin((2 * Math.PI * time) / 4.0);
    const turbNoise = 0.7 * Math.sin(2.1 * time) + 0.3 * Math.sin(5.4 * time);
    coreAlpha = Math.min(1.0, breathBase * (1 + turbNoise * 0.08) * (0.55 + 0.45 * node.payloadCapacity));
  }

  // 4. 通道 4: L2 珠链公转转速（LOCKED 冻结为 0）
  const rpm = node.status === 'LOCKED' ? 0 : 0.5 + (node.velocity / 40) * 3.5;
  const angularVelocity = (rpm * 2 * Math.PI) / 60;

  // 5. L4 板缝异常分级计算
  const isSevereAlert = node.status === 'ALERT' || node.payloadCapacity >= 0.95 || node.signalPower <= -110;
  const isMildAlert = !isSevereAlert && (node.payloadCapacity >= 0.80 || node.signalPower <= -95);

  let seamWidth = 0.5;
  let seamAlphaMin = 0.1;
  let seamAlphaMax = 0.2;

  if (isSevereAlert) {
    seamWidth = 2.0;
    seamAlphaMin = 0.65;
    seamAlphaMax = 0.75;
  } else if (isMildAlert) {
    seamWidth = 1.0;
    seamAlphaMin = 0.3;
    seamAlphaMax = 0.4;
  }

  const seamAlpha = seamAlphaMin + (seamAlphaMax - seamAlphaMin) * (0.5 + 0.5 * Math.sin((2 * Math.PI * time) / 4.0));

  return { activeTicks, l5ArcAngle, quantizedArcIndex, activeSegmentCount, coreAlpha, angularVelocity, seamWidth, seamAlpha };
}

/* ---------- L2 珠链公转相位 ---------- */

/** nodeId -> [0,1) 确定性哈希：用于错开 60 个节点的公转相位，避免整屏同步 */
function phaseHash01(nodeId: string): number {
  let h = 2166136261;
  for (let i = 0; i < nodeId.length; i++) {
    h ^= nodeId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 单颗珠子的角位置（用于逐个 position 点亮判定） */
interface BeadPose {
  x: number;
  y: number;
  /** 该珠最接近的绝对刻度槽（0..11） */
  nearestSlot: number;
}
/** 复用的珠位数组：容量 12，避免每帧分配 */
const BEAD_POSES: BeadPose[] = Array.from({ length: 12 }, () => ({ x: 0, y: 0, nearestSlot: 0 }));
const TWO_PI = Math.PI * 2;
const SLOT_STEP = TWO_PI / 12;

/**
 * 计算 12 颗珠的公转角相位（§6.2 方案 A 珠链公转 + 方案 B 位置点亮）
 * LOCKED 节点使用冻结转角（lockedSnapshot.rotationAngle），实现固化定格
 */
function computeBeadPoses(node: RelayNode, time: number, angularVelocity: number): BeadPose[] {
  const baseAngle =
    node.status === 'LOCKED' && node.lockedSnapshot
      ? node.lockedSnapshot.rotationAngle
      : time * angularVelocity + phaseHash01(node.id) * TWO_PI;

  for (let i = 0; i < 12; i++) {
    const theta = baseAngle + i * SLOT_STEP;
    const normAngle = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
    const pose = BEAD_POSES[i];
    pose.x = Math.cos(theta);
    pose.y = Math.sin(theta);
    pose.nearestSlot = Math.round(normAngle / SLOT_STEP) % 12;
  }
  return BEAD_POSES;
}

/* ---------- L6 内层脉冲光斑（§3.2 L6：径向渐变 #E6FFFA -> #00F0FF） ---------- */
/**
 * 光斑预渲染贴片：径向渐变不可在 59 节点 × 每帧循环内创建（违反零 GC 约束），
 * 故一次性烘焙为离屏画布，运行时仅以 globalAlpha + 轻微缩放做呼吸/湍流调制。
 */
let coreSpotSprite: HTMLCanvasElement | null = null;
/** 光斑贴片的 CSS 像素尺寸与半宽（缓存，避免每节点重复计算 devicePixelRatio） */
let coreSpotSize = 0;
let coreSpotHalf = 0;

function getCoreSpotSprite(): HTMLCanvasElement {
  if (coreSpotSprite) return coreSpotSprite;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size * dpr));
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d');
  coreSpotSize = size;
  coreSpotHalf = size / 2;
  if (!ctx) {
    coreSpotSprite = canvas;
    return canvas;
  }
  ctx.scale(dpr, dpr);
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, '#E6FFFA');
  grad.addColorStop(0.45, '#00F0FF');
  grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, TWO_PI);
  ctx.fill();
  coreSpotSprite = canvas;
  return canvas;
}

/** L4 井口透视下沉量（与 SpriteFactory 的 L6_SINK_DY 保持一致） */
const CORE_SINK_DY = 1.64;

/**
 * 绘制 L6 内层脉冲光斑（实时光斑渲染归属见 §3.2 L6）
 * @param coreAlpha 通道3 亮度（0.55..1.0）
 * @param time 秒，用于湍流半径扰动
 */
function drawCoreLightSpot(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  coreAlpha: number,
  time: number
): void {
  const spot = getCoreSpotSprite();
  // 湍流半径扰动：±6% 缩放（以节点基准 X 作为确定性相位偏移）
  const turb = 1 + 0.06 * Math.sin(2.1 * time + node.baseCoords[0]);
  const scale = Math.max(0.2, coreAlpha) * turb;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, coreAlpha));
  ctx.translate(0, CORE_SINK_DY); // 透视下沉
  ctx.scale(scale, scale);
  ctx.drawImage(spot, -coreSpotHalf, -coreSpotHalf, coreSpotSize, coreSpotSize);
  ctx.restore();
}

/* ---------- L2 珠链 blit（§6.2 drawBeadChain） ---------- */
/**
 * L2 珠链：先 blit 固定投影贴片与导轨，再逐颗 blit 12 颗金属珠
 * 位置点亮语义（方案 B）：珠子滑入第 <activeTicks 个绝对刻度槽即点亮，滑出即熄灭
 * @param angularVelocity 通道4 公转角速度（rad/s）；LOCKED 节点内部改用冻结转角
 */
function drawBeadChain(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  spriteSheet: NodeSpriteSheet,
  time: number,
  angularVelocity: number,
  radiusPx: number
): void {
  const rX = radiusPx * 0.95;
  const rY = rX * 0.82;
  // 点亮槽数：LOCKED 取固化快照，其余取实时连接数（上限 12）
  const activeCount = Math.min(
    12,
    Math.max(0, node.status === 'LOCKED' ? node.lockedSnapshot?.connectionCount ?? node.connectionCount : node.connectionCount)
  );

  // 1. 固定投影贴片先落（§3.2：投影"静态固定于 L4 顶面"，属基底），
  //    否则它作为实心深色盘会盖住导轨与全部珠子，导致珠链"看起来是散落的点"
  drawStaticSprite(ctx, spriteSheet.get('L2_ALL_ALL_shadow'));
  // 2. 静态导轨压在投影之上
  drawStaticSprite(ctx, spriteSheet.get(`L2_${node.type}_ALL_rail`));

  // 3. 亮珠色变体：LOCKED 用固化绿，其余用青
  const beadOff = spriteSheet.get('L2_ALL_ALL_bead_off');
  const beadOn = node.status === 'LOCKED'
    ? spriteSheet.get('L2_ALL_ALL_bead_on_green')
    : spriteSheet.get('L2_ALL_ALL_bead_on_cyan');

  // 4. 12 颗珠：位置点亮判定
  const poses = computeBeadPoses(node, time, angularVelocity);
  for (let i = 0; i < 12; i++) {
    const pose = poses[i];
    const sprite = pose.nearestSlot < activeCount ? beadOn : beadOff;
    if (sprite) {
      ctx.drawImage(sprite.canvas, pose.x * rX - sprite.anchorX, pose.y * rY - sprite.anchorY);
    }
  }
}

/**
 * 单个静态节点的 Z-order 绘制管线（严格按 §3.2 Z-order）
 * 调用前已 ctx.translate(nodeX, nodeY)，本函数一律使用局部坐标（0,0 为节点中心）
 */
function drawNodeZOrder(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  spriteSheet: NodeSpriteSheet,
  time: number
): void {
  const radius = getNodeRadius(node.type);
  const params = computeNodeVisualParams(node, time);

  // Z-1：L7 铭刻基底层
  drawStaticSprite(ctx, spriteSheet.get(`L7_${node.type}_${node.status}_base`));

  // Z-2：L6 外层多面壳 + 立即叠加内层脉冲光斑
  drawStaticSprite(ctx, spriteSheet.get(`L6_${node.type}_${node.status}_shell`));
  drawCoreLightSpot(ctx, node, params.coreAlpha, time);

  // Z-3：L5 活性环（STABLE 跳过，由 L4 板缝底纹隐现）
  if (node.status === 'LOCKED') {
    drawStaticSprite(ctx, spriteSheet.get(`L5_ALL_LOCKED_q${params.quantizedArcIndex}`));
  }

  // Z-4：L3 中心节点盘（STAGED 全展网架由实时管线处理）
  if (node.status === 'STABLE') {
    drawStaticSprite(ctx, spriteSheet.get(`L3_${node.type}_STABLE_hub`));
  } else if (node.status === 'LOCKED' || node.status === 'ALERT') {
    drawStaticSprite(ctx, spriteSheet.get(`L3_${node.type}_${node.status}_truss`));
  }

  // Z-5：L4 装甲壳闭合态（STAGED 开壳由实时管线处理）
  if (node.status !== 'STAGED') {
    drawStaticSprite(ctx, spriteSheet.get(`L4_${node.type}_${node.status}_base`));
    // D6-A：板缝量化（§7.6）—— 按 seamWidth / seamAlpha 动态叠加在装甲瓦之上
    drawL4Seams(ctx, node, params, 0, 0);
  }

  // Z-6：L2 珠链（固定投影 + 导轨 + 12 颗位置点亮珠）
  drawBeadChain(ctx, node, spriteSheet, time, params.angularVelocity, radius);

  // Z-7：L1 环形护盾 —— 同一张 52° 单段模板旋转 6 次（中心角 0/60/120/180/240/300°）
  const shield = spriteSheet.get(`L1_${node.type}_${node.status}_seg`);
  for (let i = 0; i < 6; i++) {
    drawRotatedSprite(ctx, shield, i * 60);
  }
}

/** 59 个静态节点 Z-order Blit、L2 位置点亮公转、L6 实时光斑 */
function drawStaticNodes(
  ctx: CanvasRenderingContext2D,
  nodes: Record<string, RelayNode>,
  spriteSheet: NodeSpriteSheet,
  selectedNodeId: string | null,
  time: number
): void {
  // 选中节点由 drawActiveNode 单独处理，此处跳过以免重复绘制
  const nodeIds = Object.keys(nodes);
  for (let i = 0; i < nodeIds.length; i++) {
    const id = nodeIds[i];
    if (id === selectedNodeId) continue;
    const node = nodes[id];
    if (!node) continue;

    // node.coords 为百分比坐标（0-100），按设计基准换算到世界像素
    const p = worldToPx(node.coords[0], node.coords[1]);

    ctx.save();
    ctx.translate(p.x, p.y);
    drawNodeZOrder(ctx, node, spriteSheet, time);
    ctx.restore();
  }
}

/* ================================ 活跃节点实时管线辅助 ================================ */

/** 视差各层的插值系数（λ）：pL7 质心先导 / pL6 反应舱内核 / pL4 装甲与活性环 / pL1 能量板与珠链 */
const PARALLAX_LAMBDA = { pL6: 0.98, pL4: 0.96, pL1: 0.94 } as const;
/** 视差最大偏移钳制（世界像素） */
const PARALLAX_CLAMP = 1.2;

/**
 * 四级视差跟随（施工文档 §6.3 完整实现）
 * pL7 立即对齐目标；pL6/pL4/pL1 以不同 λ 指数逼近，并统一钳制在 1.2px 内
 */
function updateDragParallax(targetX: number, targetY: number): void {
  const s = parallaxState;
  s.pL7.x = targetX;
  s.pL7.y = targetY;

  s.pL6.x += (targetX - s.pL6.x) * PARALLAX_LAMBDA.pL6;
  s.pL6.y += (targetY - s.pL6.y) * PARALLAX_LAMBDA.pL6;

  s.pL4.x += (targetX - s.pL4.x) * PARALLAX_LAMBDA.pL4;
  s.pL4.y += (targetY - s.pL4.y) * PARALLAX_LAMBDA.pL4;

  s.pL1.x += (targetX - s.pL1.x) * PARALLAX_LAMBDA.pL1;
  s.pL1.y += (targetY - s.pL1.y) * PARALLAX_LAMBDA.pL1;

  clampParallax(s.pL6, targetX, targetY);
  clampParallax(s.pL4, targetX, targetY);
  clampParallax(s.pL1, targetX, targetY);
}

/** 把某层视差偏移钳制在目标点周围 PARALLAX_CLAMP 内 */
function clampParallax(layer: { x: number; y: number }, targetX: number, targetY: number): void {
  const dx = layer.x - targetX;
  const dy = layer.y - targetY;
  const dist = Math.hypot(dx, dy);
  if (dist > PARALLAX_CLAMP) {
    layer.x = targetX + (dx / dist) * PARALLAX_CLAMP;
    layer.y = targetY + (dy / dist) * PARALLAX_CLAMP;
  }
}

/** 开壳总时长（ms） */
const ARMOR_OPEN_TOTAL_MS = 500;

/**
 * L4 差速开壳进度（§3.2 L4 STAGED 时序）
 * 主装甲 0~350ms 翻至 25°；副装甲延迟 120ms，120~500ms 翻至 15°
 */
function computeArmorOpenProgress(elapsedMs: number): { mainAngle: number; subAngle: number } {
  const t = Math.max(0, Math.min(elapsedMs, ARMOR_OPEN_TOTAL_MS));
  const mainProgress = t <= 0 ? 0 : Math.min(1, t / 350);
  const subProgress = t <= 120 ? 0 : Math.min(1, (t - 120) / (ARMOR_OPEN_TOTAL_MS - 120));
  return { mainAngle: 25 * mainProgress, subAngle: 15 * subProgress };
}

/**
 * L4 四段装甲的深度重排序序列表（模块级预分配，零逐帧分配）
 * 顺序固定 Seg2(315°) -> Seg1(45°) -> Seg3(225°) -> Seg0(135°)：由远及近，最后画迎光最近段
 */
const ARMOR_DEPTH_ORDER: { angle: number; isMain: boolean }[] = [
  { angle: 315, isMain: true },
  { angle: 45, isMain: false },
  { angle: 225, isMain: false },
  { angle: 135, isMain: true },
];

/**
 * D6-A：L4 板缝量化动态绘制（v1.8 §7.6 板缝量化表）
 *
 * 装甲瓦本体由 sprite 静态烘焙（含 5° 微缝），但板缝的**宽度与呼吸亮度需按负载/信号异常分级**
 * 逐帧变化（computeNodeVisualParams 的 seamWidth / seamAlpha），因此这一层放在渲染期叠加：
 * 沿每段装甲中心角画一道 seamWidth 宽的深色弧线，透明度取 seamAlpha（随 4s 周期呼吸）。
 */
function drawL4Seams(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  params: NodeVisualParams,
  offsetX: number,
  offsetY: number
): void {
  const rOuter = getNodeRadius(node.type);
  const rInner = rOuter * 0.55;
  const halfGap = (5 * Math.PI) / 360; // 与 sprite 工厂一致的 5° 微缝半角
  const rMid = (rOuter + rInner) / 2;
  const rYMid = rMid * 0.82;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.strokeStyle = `rgba(255, 0, 85, ${Math.max(0, Math.min(1, params.seamAlpha))})`;
  ctx.lineWidth = Math.max(0.4, params.seamWidth);
  for (let i = 0; i < ARMOR_DEPTH_ORDER.length; i++) {
    const midA = (ARMOR_DEPTH_ORDER[i].angle * Math.PI) / 180;
    const a0 = midA - halfGap;
    const a1 = midA + halfGap;
    ctx.beginPath();
    ctx.ellipse(0, 0, rMid, rYMid, 0, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * L4 STAGED 四段装甲按 2.5D 深度重排序绘制（§6.2 drawStagedArmorSegments）
 * 贴片为「方位中立的单段模板」（sprite 工厂以 centerOverride=0 烘焙），
 * 故此处按 §6.2 契约旋转到该段的绝对方位角；开壳进度仅用于阶段性可见性判定。
 */
function drawArmorSegments(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  spriteSheet: NodeSpriteSheet,
  elapsedMs: number
): void {
  const { mainAngle, subAngle } = computeArmorOpenProgress(elapsedMs);
  const mainSprite = spriteSheet.get(`L4_${node.type}_STAGED_segMain`);
  const subSprite = spriteSheet.get(`L4_${node.type}_STAGED_segSub`);

  for (let i = 0; i < ARMOR_DEPTH_ORDER.length; i++) {
    const seg = ARMOR_DEPTH_ORDER[i];
    const openAngle = seg.isMain ? mainAngle : subAngle;
    if (openAngle <= 0) continue; // 尚未开始抬升的装甲段保持闭合
    drawRotatedSprite(ctx, seg.isMain ? mainSprite : subSprite, seg.angle);
  }
}

/** L5 STAGED/ALERT 实时脉冲短弧（STABLE 跳过；LOCKED 走预渲染 q 档贴片） */
function drawL5ReactiveArc(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  params: NodeVisualParams,
  color: string
): void {
  const rX = getNodeRadius(node.type) * 0.55 * 0.9;
  const rY = rX * 0.82;
  const segCount = Math.max(1, params.activeSegmentCount);
  // 总跨度内均匀排布 segCount 段，每段占 45°、间隙 15°
  const step = (45 + 15) * (Math.PI / 180);
  const span = (45 * Math.PI) / 180;
  // 起始角：使整体跨度以 90°（正下方）为中心对称铺开
  const totalRad = params.l5ArcAngle;
  const startAngle = Math.PI / 2 - totalRad / 2;

  ctx.save();
  ctx.lineWidth = 0.5;
  for (let i = 0; i < segCount; i++) {
    const a0 = startAngle + i * step;
    ctx.beginPath();
    ctx.ellipse(0, 0, rX, rY, 0, a0, a0 + span);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * L1 ALERT 运行时涟漪波（Sprite 内只烘焙静态碎裂形态）
 * 2 圈向外扩散的椭圆弧，相位由 time 驱动
 */
function drawAlertRipple(ctx: CanvasRenderingContext2D, node: RelayNode, time: number): void {
  const baseR = getNodeRadius(node.type) * 1.15;
  ctx.save();
  ctx.strokeStyle = '#FF0055';
  for (let ring = 0; ring < 2; ring++) {
    // 两圈相位错开半个周期，形成连续外扩
    const phase = ((time * 0.9 + ring * 0.5) % 1 + 1) % 1;
    const rX = baseR + phase * 4.5;
    const rY = rX * 0.82;
    ctx.globalAlpha = 0.35 * (1 - phase);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, rX, rY, 0, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

/**
 * 活跃节点 Z-order 绘制（与 drawNodeZOrder 同序，但整体挂载 4 级视差偏移）
 * @param renderL4 false 时跳过 L4（由调用方按 phase 用实时开壳管线单独绘制）
 * @param skipL5 true 时跳过 L5（由调用方实时绘制）
 */
function drawActiveLayers(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  spriteSheet: NodeSpriteSheet,
  time: number,
  renderL4: boolean,
  skipL5: boolean
): void {
  const params = computeNodeVisualParams(node, time);
  const radius = getNodeRadius(node.type);

  // Z-1：L7（挂 pL4 视差）
  ctx.save();
  ctx.translate(parallaxState.pL4.x, parallaxState.pL4.y);
  drawStaticSprite(ctx, spriteSheet.get(`L7_${node.type}_${node.status}_base`));
  ctx.restore();

  // Z-2：L6 外层壳 + 内层光斑（挂 pL6 视差；STAGED/ALERT 提升亮度）
  ctx.save();
  ctx.translate(parallaxState.pL6.x, parallaxState.pL6.y);
  drawStaticSprite(ctx, spriteSheet.get(`L6_${node.type}_${node.status}_shell`));
  const brighten = node.status === 'STAGED' || node.status === 'ALERT' ? 1.25 : 1.0;
  drawCoreLightSpot(ctx, node, Math.min(1, params.coreAlpha * brighten), time);
  ctx.restore();

  // Z-3：L5（挂 pL4 视差；LOCKED 走预渲染 q 档贴片，STAGED/ALERT 由调用方实时绘制）
  if (!skipL5) {
    ctx.save();
    ctx.translate(parallaxState.pL4.x, parallaxState.pL4.y);
    if (node.status === 'LOCKED') {
      drawStaticSprite(ctx, spriteSheet.get(`L5_ALL_LOCKED_q${params.quantizedArcIndex}`));
    }
    ctx.restore();
  }

  // Z-4：L3 桁架（挂 pL1 视差）
  ctx.save();
  ctx.translate(parallaxState.pL1.x, parallaxState.pL1.y);
  if (node.status === 'STABLE') {
    drawStaticSprite(ctx, spriteSheet.get(`L3_${node.type}_STABLE_hub`));
  } else {
    drawStaticSprite(ctx, spriteSheet.get(`L3_${node.type}_${node.status}_truss`));
  }
  ctx.restore();

  // Z-5：L4 装甲（挂 pL4 视差；STAGED 由调用方走实时开壳管线）
  if (renderL4) {
    ctx.save();
    ctx.translate(parallaxState.pL4.x, parallaxState.pL4.y);
    drawStaticSprite(ctx, spriteSheet.get(`L4_${node.type}_${node.status}_base`));
    // D6-A：板缝量化（§7.6）—— 与静态节点同源，保证活跃节点也有一致的板缝呼吸
    drawL4Seams(ctx, node, params, 0, 0);
    ctx.restore();
  }

  // Z-6：L2 珠链（挂 pL1 视差）
  ctx.save();
  ctx.translate(parallaxState.pL1.x, parallaxState.pL1.y);
  drawBeadChain(ctx, node, spriteSheet, time, params.angularVelocity, radius);
  ctx.restore();

  // Z-7：L1 护盾 6 段（挂 pL1 视差）
  ctx.save();
  ctx.translate(parallaxState.pL1.x, parallaxState.pL1.y);
  const shield = spriteSheet.get(`L1_${node.type}_${node.status}_seg`);
  for (let i = 0; i < 6; i++) {
    drawRotatedSprite(ctx, shield, i * 60);
  }
  ctx.restore();
}

/** 活跃节点自身的浮起阻尼（世界像素渐进）：拖拽刚抬起时由 0 平滑趋向目标，保证层级间自然分离 */
const ACTIVE_RISE_LAMBDA = 0.18;

/**
 * 活跃节点绘制：L4 深度排序掀开 + L5 实时弧 + L1 ALERT 涟漪 + 4 级视差跟随
 *
 * 绘制路径说明：本函数与静态节点一样使用 sprite blit（故放大后同样会因位图分辨率而模糊，
 * LOD 批次会改为高倍率下走实时矢量绘制）。差异在于它额外叠加实时开壳 / 短弧 / 涟漪 / 光斑调制。
 *
 * 视差与所有层同处世界坐标系，随视口一同缩放 —— 不得使用 1/scale 反向缩放，
 * 否则会在放大时把整个活跃节点缩回去（曾导致"选中节点不跟随缩放"）。
 */
function drawActiveNode(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  phase: TopologyCanvasProps['phase'],
  heatLevel: number,
  spriteSheet: NodeSpriteSheet,
  armorOpenElapsedMs: number,
  dragWorld: { x: number; y: number } | null,
  targetCoords: [number, number] | null,
  reboundStart: { time: number; x: number; y: number } | null,
  now: number
): void {
  const time = performance.now() / 1000;
  const isSimulating = phase === 'STAGE1_SIMULATION' || phase === 'STAGE2_DECISION';

  // 1. 视差目标点：推演态下按热负荷上浮（世界像素，量级与节点半径挂钩），其余状态收敛回零
  const radius = getNodeRadius(node.type);
  const rise = isSimulating ? radius * (0.09 + Math.min(1, Math.max(0, heatLevel)) * 0.06) : 0;
  const p7 = parallaxState.pL7;
  p7.x += (0 - p7.x) * ACTIVE_RISE_LAMBDA;
  p7.y += (-rise - p7.y) * ACTIVE_RISE_LAMBDA;
  // 以 pL7 的浮起量为目标点，驱动 pL6 / pL4 / pL1 的差速跟随
  updateDragParallax(p7.x, p7.y);

  // 2. 锚点派生：与连线端点共用 deriveActiveAnchor，避免两处逻辑分叉
  const [anchorX, anchorY] = deriveActiveAnchor(node, phase, dragWorld, targetCoords, reboundStart, now);
  const anchorPx = worldToPx(anchorX, anchorY);

  ctx.save();
  ctx.translate(anchorPx.x, anchorPx.y);

  const l5Live = isSimulating || node.status === 'ALERT';
  // 2. L7~L1 主体（L4 在推演态交由实时开壳管线，故此处渲染时跳过）
  drawActiveLayers(ctx, node, spriteSheet, time, !isSimulating, l5Live);

  // 3. Z-5：L4 STAGED 差速开壳（深度重排序 Seg2→Seg1→Seg3→Seg0）
  if (isSimulating) {
    ctx.save();
    ctx.translate(parallaxState.pL4.x, parallaxState.pL4.y);
    drawArmorSegments(ctx, node, spriteSheet, armorOpenElapsedMs);
    ctx.restore();
  }

  // 4. Z-3 实时：L5 STAGE1/STAGE2 琥珀 / ALERT 品红
  if (l5Live) {
    ctx.save();
    ctx.translate(parallaxState.pL4.x, parallaxState.pL4.y);
    drawL5ReactiveArc(ctx, node, computeNodeVisualParams(node, time), node.status === 'ALERT' ? '#FF0055' : '#F59E0B');
    ctx.restore();
  }

  // 5. L1 ALERT 涟漪波（运行时叠加，sprite 内仅静态碎裂形态）
  if (node.status === 'ALERT') {
    ctx.save();
    ctx.translate(parallaxState.pL1.x, parallaxState.pL1.y);
    drawAlertRipple(ctx, node, time);
    ctx.restore();
  }

  // 6. 热负荷告警：STAGE2 且热负荷越过 0.85 警戒阈值时叠加琥珀告警环
  if (phase === 'STAGE2_DECISION' && heatLevel >= 0.85) {
    const rX = getNodeRadius(node.type) * 1.15;
    ctx.save();
    ctx.translate(parallaxState.pL1.x, parallaxState.pL1.y);
    ctx.strokeStyle = '#F59E0B';
    ctx.globalAlpha = Math.min(1, (heatLevel - 0.85) / 0.15) * 0.6;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rX, rX * 0.82, 0, 0, TWO_PI);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  ctx.restore();
}

/* ================================ 标签模式（§7.3 + D10/D17/D18） ================================ */

/** 标签模式配色（模块级常量，零逐帧分配） */
const LABEL_FONT = '9px "JetBrains Mono", monospace';
const LABEL_COLOR_NORMAL = '#8B949E';
const LABEL_COLOR_SELECTED = '#00F0FF';
/** ID 短码前缀首字母：HUB->H / RELAY->R / PROBE->P / SCANNER->S */
const TYPE_SHORT_PREFIX: Record<NodeType, string> = { HUB: 'H', RELAY: 'R', PROBE: 'P', SCANNER: 'S' };

/** 演示标签模式：每个可见节点旁绘制短格式标签 */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  nodes: Record<string, RelayNode>,
  selectedNodeId: string | null,
  qosTier: 1 | 2 | 3,
  time: number
): void {
  // 1. 性能优先档直接禁用标签；Tier1/Tier2 不受影响（D17：标签不受 QoS 降级影响）
  if (qosTier === 3) return;

  const ids = Object.keys(nodes);
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const node = nodes[id];
    if (!node) continue;

    const params = computeNodeVisualParams(node, time);
    const isSelected = id === selectedNodeId;
    const label =
      `${TYPE_SHORT_PREFIX[node.type]}-${id.split('-')[1] ?? id}` +
      ` · V${node.velocity.toFixed(1)}` +
      ` · S${node.signalPower.toFixed(1)}` +
      ` · P${node.payloadCapacity.toFixed(2)}` +
      ` · C${params.activeTicks}`;

    // 2. 位置：节点中心右侧 12px、下方 4px（世界像素）
    const base = worldToPx(node.coords[0], node.coords[1]);
    const x = base.x + 12;
    const y = base.y + 4;

    // 3. 描边底衬（深色描边），保证任意底色上的可读性
    ctx.strokeStyle = 'rgba(6, 8, 11, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.strokeText(label, x, y);

    ctx.fillStyle = isSelected ? LABEL_COLOR_SELECTED : LABEL_COLOR_NORMAL;
    ctx.fillText(label, x, y);
  }

  ctx.restore();
}

/* ================================ 组件本体 ================================ */

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  phase: _phase,
  targetCoords,
  onSelectNode,
  onDragNode,
  onEnterDecisionStage,
  onAbortDecision,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useCanvasDPR(canvasRef);

  /* ---------- Ref 透传：高频渲染循环只建立一次订阅，数据经 Ref 读取 ---------- */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const phaseRef = useRef(_phase);
  phaseRef.current = _phase;
  const targetCoordsRef = useRef(targetCoords);
  targetCoordsRef.current = targetCoords;

  /* ---------- 单例资源：首次挂载构建一次，卸载不销毁（复用） ---------- */
  const spriteSheetRef = useRef<NodeSpriteSheet | null>(null);
  if (spriteSheetRef.current === null) {
    spriteSheetRef.current = buildNodeSpriteSheet(); // 106 条离屏图集，仅构建一次
  }
  const particlePoolRef = useRef<ParticlePool | null>(null);
  if (particlePoolRef.current === null) {
    particlePoolRef.current = createParticlePool(); // 512 颗固定容量零 GC 池
  }

  /* ---------- 标签模式开关：走 ref（只影响 Canvas 绘制，不参与 React 渲染） ---------- */
  const isTagModeActiveRef = useRef(false);

  /* ---------- T 键监听：切换标签模式（D18 生效边界 / 进入 STAGE1 自动关闭） ---------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 't' && e.key !== 'T') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      // D18 生效边界：仅稳态待命与已固化两态响应
      if (phaseRef.current !== 'STABLE_IDLE' && phaseRef.current !== 'COMMITTED') return;
      isTagModeActiveRef.current = !isTagModeActiveRef.current;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ---------- 自动关闭（D18）：进入推演态即关闭标签模式 ---------- */
  useEffect(() => {
    const p = _phase;
    if (p !== 'STABLE_IDLE' && p !== 'COMMITTED') {
      isTagModeActiveRef.current = false;
    }
  }, [_phase]);

  /* ---------- 帧时间：引擎回调不提供 dt，由上一帧时间戳自维护 ---------- */
  const lastFrameTimeRef = useRef(0);

  /* ---------- L4 开壳计时：仅记录「首次进入推演态」的时刻，STAGE1->STAGE2 不重置 ---------- */
  const prevPhaseRef = useRef<FSMPhase>('STABLE_IDLE');
  const armorOpenStartRef = useRef<number | null>(null);
  /**
   * AUTO_ABORT 阻尼回弹起点（世界百分比）。
   * 进入 AUTO_ABORT 时记录当帧锚点（= targetCoords），此后 1.2s 内以弹簧解析解回弹到 node.coords。
   */
  const reboundRef = useRef<{ time: number; x: number; y: number } | null>(null);

  /* ---------- 指针拖拽状态（全部走 ref，零 React setState） ---------- */
  const isPointerDownRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasMovedPastThresholdRef = useRef(false);
  const draggedNodeIdRef = useRef<string | null>(null);
  /**
   * 指针当前世界百分比坐标。
   * 唯一用途：松手瞬间为 AUTO_ABORT 提供回弹起点 —— 此刻 FSM 的 targetCoords 可能尚未经 React
   * 回灌到 Props，若直接从 targetCoords 取起点会产生一帧跳变。它不参与 STAGE1/STAGE2 的锚点派生。
   */
  const pointerWorldRef = useRef<{ x: number; y: number } | null>(null);

  /* ---------- 视口：缩放 / 平移（全部走 ref，React 零重渲染） ---------- */
  const viewportRef = useRef({ scale: INITIAL_SCALE, offsetX: 0, offsetY: 0, initialized: false });
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  /* ---------- 视口尺寸同步 + 首次初始化 ----------
   * useCanvasDPR 通过 ResizeObserver 异步标定 canvas.width/height，首帧逻辑尺寸可能为 0，
   * 故此处同样用 ResizeObserver 感知尺寸就绪，就绪后把世界中心对齐到画布中心（只做一次）。 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      if (cw <= 0 || ch <= 0) return;
      const vp = viewportRef.current;
      if (!vp.initialized) {
        vp.scale = INITIAL_SCALE;
        vp.offsetX = cw / 2 - (DESIGN_W / 2) * INITIAL_SCALE;
        vp.offsetY = ch / 2 - (DESIGN_H / 2) * INITIAL_SCALE;
        vp.initialized = true;
      }
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  /* ---------- 高频渲染主循环：订阅 MatrixEngine，React 侧零重渲染 ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const spriteSheet = spriteSheetRef.current;
    const particlePool = particlePoolRef.current;
    if (!spriteSheet || !particlePool) return;

    // 引擎 QoS 为字符串枚举（TIER_1_QUALITY…），此处映射为渲染层数字档位 1/2/3
    const mapQosTier = (tier: string): 1 | 2 | 3 =>
      tier === 'TIER_3_PERFORMANCE' ? 3 : tier === 'TIER_2_BALANCED' ? 2 : 1;

    const renderFrame = (
      ctx2: CanvasRenderingContext2D,
      dt: number,
      dpr: number,
      timeSec: number,
      now: number,
      engineHeat: number,
      engineTierNum: 1 | 2 | 3
    ): void => {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const currentSelectedId = selectedNodeIdRef.current;
      const currentPhase = phaseRef.current;
      const currentTarget = targetCoordsRef.current;
      // heatLevel 与 qosTier 一律取引擎高频回调值（画布不经 Props 接收，避免双真值源）
      const currentHeat = engineHeat;
      const currentTier = engineTierNum;
      const vp = viewportRef.current;
      const isSimulating = currentPhase === 'STAGE1_SIMULATION' || currentPhase === 'STAGE2_DECISION';
      // 拖拽中的世界坐标：仅推演态生效，松手后回落 node.coords
      const dragWorld = isSimulating ? pointerWorldRef.current : null;

      /**
       * 相位变迁处理必须先于一切绘制：连线（step 1）与活跃节点（step 4）都要读回弹起点，
       * 且两者必须读到同一帧的同一个值。
       */
      const activeNode = currentSelectedId ? currentNodes[currentSelectedId] : undefined;
      if (activeNode) {
        const prev = prevPhaseRef.current;
        const prevSimulating = prev === 'STAGE1_SIMULATION' || prev === 'STAGE2_DECISION';
        if (isSimulating && !prevSimulating) {
          // L4 开壳计时：仅在「由非推演态首次进入 STAGE1」时记录起点，STAGE1->STAGE2 持续累加不重置
          armorOpenStartRef.current = now;
        } else if (!isSimulating) {
          armorOpenStartRef.current = null;
        }

        if (currentPhase === 'AUTO_ABORT') {
          if (!reboundRef.current) {
            // 记录回弹起点：推演中为指针位置 / targetCoords，避免松手瞬间闪烁到原位
            const from = pointerWorldRef.current
              ?? (currentTarget ? { x: currentTarget[0], y: currentTarget[1] } : { x: activeNode.coords[0], y: activeNode.coords[1] });
            reboundRef.current = { time: now, x: from.x, y: from.y };
          }
        } else if (reboundRef.current) {
          // 离开 AUTO_ABORT（闭环回到 STABLE_IDLE 或用户重新开始推演）即清空回弹状态
          reboundRef.current = null;
        }
        prevPhaseRef.current = currentPhase;
      } else {
        // 无活跃节点时复位开壳计时 / 回弹 / 相位记忆，避免下次拖拽复用陈旧进度
        armorOpenStartRef.current = null;
        reboundRef.current = null;
        prevPhaseRef.current = currentPhase;
      }
      const reboundStart = reboundRef.current;

      ctx2.save();
      // 视口变换：世界（设计基准像素）-> 屏幕 CSS 像素，再叠加 DPR
      ctx2.setTransform(dpr * vp.scale, 0, 0, dpr * vp.scale, dpr * vp.offsetX, dpr * vp.offsetY);
      ctx2.clearRect(-4 * DESIGN_W, -4 * DESIGN_H, DESIGN_W * 10, DESIGN_H * 10);

      // 1. 绘制拓扑连线（线宽按 viewScale 反比缩放；活跃节点端点与节点本体共用派生锚点）
      drawTopologyEdges(
        ctx2,
        currentEdges,
        currentNodes,
        vp.scale,
        currentSelectedId,
        currentPhase,
        dragWorld,
        currentTarget,
        reboundStart,
        now
      );

      // 2. 绘制静态节点（Z-order Blit + L2 珠链公转 + L6 实时光斑）
      drawStaticNodes(ctx2, currentNodes, spriteSheet, currentSelectedId, timeSec);

      // 3. 绘制粒子（性能优先档跳过粒子系统）
      if (currentTier !== 3) {
        particlePool.update(dt);
        drawParticles(ctx2, particlePool, spriteSheet);
      }

      // 4. 绘制活跃节点（仅当存在有效选中节点）
      if (activeNode) {
        const armorElapsed = armorOpenStartRef.current === null ? 0 : now - armorOpenStartRef.current;
        drawActiveNode(
          ctx2,
          activeNode,
          currentPhase,
          currentHeat,
          spriteSheet,
          armorElapsed,
          dragWorld,
          currentTarget,
          reboundStart,
          now
        );
      }

      // 5. 绘制标签（仅标签模式激活；Tier3 由 drawLabels 内部直接跳过）
      if (isTagModeActiveRef.current) {
        drawLabels(ctx2, currentNodes, currentSelectedId, currentTier, timeSec);
      }

      ctx2.restore();
    };

    const unsubscribe = MatrixEngine.getInstance().subscribe(({ timeSec, qosTier: engineTier, heatLevel: engineHeat }) => {
      // DT 自维护：引擎回调不含 dt，用上一帧时间戳差分
      const now = performance.now();
      const dt = lastFrameTimeRef.current === 0 ? 0 : Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
      lastFrameTimeRef.current = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderFrame(ctx, dt, dpr, timeSec, now, engineHeat, mapQosTier(engineTier));
    });

    return unsubscribe;
  }, []);

  /* ---------- 指针交互：视口(缩放/平移) + 命中检测 + 拖拽派发 ---------- */

  /** 取画布 CSS 像素矩形 */
  const getRect = (): DOMRect | null => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getBoundingClientRect() : null;
  };

  /* ---------- 滚轮缩放：以光标为不动点（必须 passive: false 才能 preventDefault） ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const vp = viewportRef.current;
      const nextScale = clampScale(vp.scale * Math.exp(-e.deltaY * WHEEL_SENSITIVITY));
      if (nextScale === vp.scale) return;
      // 保持光标下的世界点不动：offset' = s - (s - offset) * (next / prev)
      const k = nextScale / vp.scale;
      vp.offsetX = sx - (sx - vp.offsetX) * k;
      vp.offsetY = sy - (sy - vp.offsetY) * k;
      vp.scale = nextScale;
      vp.initialized = true;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * 屏幕坐标命中检测（仅 STABLE 可交互，v1.8 PRD §4.2）
   * 判定在屏幕空间进行：世界坐标先经视口变换再比距离，命中半径为恒定 20 屏幕像素
   */
  const hitTestNode = (sx: number, sy: number, rect: DOMRect): RelayNode | null => {
    const vp = viewportRef.current;
    const hitRadiusScreen = 20;
    let best: RelayNode | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    const ids = Object.keys(nodesRef.current);
    for (let i = 0; i < ids.length; i++) {
      const node = nodesRef.current[ids[i]];
      if (!node) continue;
      if (node.status !== 'STABLE') continue;
      const wp = worldToPx(node.coords[0], node.coords[1]);
      const nodeScreenX = wp.x * vp.scale + vp.offsetX;
      const nodeScreenY = wp.y * vp.scale + vp.offsetY;
      if (nodeScreenX < -hitRadiusScreen || nodeScreenX > rect.width + hitRadiusScreen) continue;
      if (nodeScreenY < -hitRadiusScreen || nodeScreenY > rect.height + hitRadiusScreen) continue;
      const d = Math.hypot(sx - nodeScreenX, sy - nodeScreenY);
      if (d <= hitRadiusScreen && d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  };

  /** 双击空白区：视口归零到 1x（命中节点时不重置，避免误触） */
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = getRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (hitTestNode(sx, sy, rect)) return;
    const vp = viewportRef.current;
    vp.scale = 1;
    vp.offsetX = 0;
    vp.offsetY = 0;
    vp.initialized = true;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = getRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const vp = viewportRef.current;

    const hit = hitTestNode(sx, sy, rect);

    // 点到节点：进入节点拖拽流程
    if (hit) {
      isPointerDownRef.current = true;
      hasMovedPastThresholdRef.current = false;
      draggedNodeIdRef.current = hit.id;
      dragStartRef.current = { x: sx, y: sy };
      pointerWorldRef.current = { x: hit.coords[0], y: hit.coords[1] };
      onSelectNode(hit.id);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // 点到空白：进入画布平移模式
    isPanningRef.current = true;
    panStartRef.current = { x: sx, y: sy, offsetX: vp.offsetX, offsetY: vp.offsetY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = getRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const vp = viewportRef.current;

    // 1. 平移模式：直接改视口偏移
    if (isPanningRef.current && panStartRef.current) {
      vp.offsetX = panStartRef.current.offsetX + (sx - panStartRef.current.x);
      vp.offsetY = panStartRef.current.offsetY + (sy - panStartRef.current.y);
      return;
    }

    // 2. 节点拖拽模式
    if (!isPointerDownRef.current || !dragStartRef.current) return;
    // 拖拽派发用世界百分比坐标，与视口无关
    const world = screenToWorld(sx, sy, vp);
    pointerWorldRef.current = world;

    const moveDist = Math.hypot(sx - dragStartRef.current.x, sy - dragStartRef.current.y);
    // 跨过 5px 阈值后：本次及之后每次 move 都上报（首次即 START_SIMULATION，其后为坐标更新；
    // FSM reducer 的守卫自行忽略不合法的重复 action，画布不判断是否已在 STAGE1）
    if (!hasMovedPastThresholdRef.current && moveDist > 5) {
      hasMovedPastThresholdRef.current = true;
    }
    if (hasMovedPastThresholdRef.current && draggedNodeIdRef.current) {
      onDragNode(draggedNodeIdRef.current, world.x, world.y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = getRect();

    // 1. 平移模式收尾
    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    // 2. 节点拖拽收尾
    if (!isPointerDownRef.current || !dragStartRef.current) return;
    if (rect) {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const moveDist = Math.hypot(sx - dragStartRef.current.x, sy - dragStartRef.current.y);
      const threshold = rect.width * 0.15; // 15% 画布宽度（屏幕像素）

      if (hasMovedPastThresholdRef.current) {
        // 松手前最后上报一次落点，确保 FSM 的 targetCoords 与视觉落点一致
        // （COMMITTED 固化快照依赖 targetCoords 记录最终位置）
        const releaseWorld = screenToWorld(sx, sy, viewportRef.current);
        pointerWorldRef.current = releaseWorld;
        if (draggedNodeIdRef.current) {
          onDragNode(draggedNodeIdRef.current, releaseWorld.x, releaseWorld.y);
        }
        if (moveDist >= threshold) {
          onEnterDecisionStage(); // STAGE1 -> STAGE2
        } else {
          onAbortDecision(); // 位移不足 -> AUTO_ABORT
        }
      }
    }

    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    isPointerDownRef.current = false;
    dragStartRef.current = null;
    hasMovedPastThresholdRef.current = false;
    draggedNodeIdRef.current = null;
    // 松手后清空指针世界坐标，活跃节点回落 node.coords
    pointerWorldRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      className="h-full w-full cursor-crosshair touch-none"
    />
  );
};
