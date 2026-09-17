# AstroMatrix · 节点本体重做施工文档（IMPLEMENTATION_SPEC_NODE_REBUILD）

**版本**：v1.3（SpriteFactory 完备参数与渲染深度排序闭环版）  
**定位**：以文件为单位的接口契约与代码迁移规范，平行于既有 `IMPLEMENTATION_SPEC.md`。供编码 AI / 开发者直接按文件生产代码。  
**上游依据**：`tasks/NODE_DESIGN_PRD.md` v1.8（33 项决策拍板，作为需求唯一真值源） / `tasks/施工文档（修改版）.md`（施工运行基线）。  
**设计原则**：按代码文件组织、给出明确接口签名与**像素级异构绘制实现细节**、严格约束输入输出、不重复需求解释。

---

## 变更记录

| 版本 | 变更内容 |
|------|----------|
| v1.0 | 初版：文件结构变更、domain.ts 契约、同心椭圆 Sprite 90 命名规范、粒子池与双层管线接口 |
| v1.1 | 异构几何重构：6段板/12珠链/X网架/搭接瓦/点阵短弧/多面壳光斑；103 条目 Sprite 命名；分批重构 |
| v1.2 | 实现层参数闭环：L2 方案 A 导轨单珠滑动、L5 方案 C 8 档组合、L6 内层光斑归属、L4 精确角度与 500ms 差速曲线 |
| v1.3 | **SpriteFactory 实现参数全量补齐与渲染语义闭环（5 大实现缺失 + 1 项语义拍板）**：<br>1. **L2 亮珠色变体拍板**：采纳独立 Sprite 方案，拆分为 `L2_ALL_ALL_bead_on_cyan`（#00F0FF 青色亮珠）与 `L2_ALL_ALL_bead_on_green`（#3FB950 固化绿亮珠），零开销 blit，图集条目数调整至 106<br>2. **L5 8 档组合参数精确落表**：明确给出 `q0..q7` 每档的段数（3/4/5）、跨度（90°~330°）与起始角度偏移基准<br>3. **L1 6 段旋转中心角度明确**：明确 6 段弧形能量板的旋转中心角分别为 **0°、60°、120°、180°、240°、300°**（每段 52°，断口 8°）<br>4. **补全 3 大渲染辅助函数定义**：显式定义 `getNodeRadius`、`drawStaticSprite`、`drawRotatedSprite` 的代码实现与职责契约<br>5. **L4 STAGED 态 2.5D 深度重排序**：STAGED 掀开时废除静态搭接顺时针顺序，切换为 **2.5D Y 轴深度从后往前绘制**（Seg2 背光最远 $\to$ Seg1/Seg3 侧翼 $\to$ Seg0 迎光最近）<br>6. **L2 刻度点亮语义拍板（方案 B）**：点亮为**位置属性（空间刻度槽）**——轨道上固定 12 个刻度位，前 `connectionCount` 个位置处于激活导通态；滑动的珠子经由激活位置时被点亮，离开后熄灭 |

---

## 1. 项目结构变更（Directory Diff）

```diff
  src/
  ├── types/
- │   ├── domain.ts                      # 旧版本类型定义
+ │   ├── domain.ts                      # 重构：NodeStatus v2、coords/baseCoords、LockedSnapshot
  │   └── fsm.ts                         # 保持不动
  ├── core/
  │   ├── MatrixEngine.ts                # 保持不动
+ │   ├── nodeSpriteFactory.ts           # 新增：异构 2.5D 精密材质 Sprite 图集离屏工厂
+ │   ├── particlePool.ts                # 新增：512 颗 Float32Array 零 GC 粒子对象池
  │   └── springPhysics.ts               # 保持不动
  ├── components/
  │   ├── topology/
- │   │   ├── TopologyCanvas.tsx         # 重构：2.5D 异构双层渲染管线、Z-order、特效挂载
+ │   │   ├── TopologyCanvas.tsx         # 重构后（骨架 + 模块化填充）
+ │   │   └── NodeOverlayCard.tsx        # 重做：四指标真实值 + 异构视觉百分比 + 量化档
  │   ├── telemetry/
  │   │   └── TelemetryScope.tsx         # 保持不动
  │   └── ui/
  │       └── (其余所有 UI 组件保持不动)
  ├── services/
- │   └── mockDataGenerator.ts           # 小改：生成 60 节点同心星座拓扑、connectionCount
  └── App.tsx                            # 小改：对接新 NodeStatus、LOCKED 固化快照分发
```

### 迁移范围判定

| 分类 | 文件列表 |
|------|----------|
| **重写 (Rewrite)** | `src/components/topology/TopologyCanvas.tsx`、`src/components/topology/NodeOverlayCard.tsx` |
| **新增 (New)** | `src/core/nodeSpriteFactory.ts`、`src/core/particlePool.ts` |
| **小改 (Minor Edit)** | `src/types/domain.ts`、`src/services/mockDataGenerator.ts`、`src/App.tsx` |
| **完全不动 (Untouched)** | `MatrixEngine.ts`、`useDecisionEngine.ts`、`MatrixContext.tsx`、`KeyboardMatrix.tsx`、`DecisionStatusBar.tsx`、`InterlockingBreadcrumb.tsx`、`HeatIndexMeter.tsx`、`TelemetryScope.tsx`、`DeepSpaceBackground.tsx`、`springPhysics.ts`、`useCanvasDPR.ts`、`fsm.ts` |

---

## 2. 类型定义层（src/types/domain.ts）

### 2.1 完整代码契约

```typescript
/**
 * 节点四态枚举（NodeStatus v2）
 * 严格对齐 NODE_DESIGN_PRD v1.8 状态体系
 */
export type NodeStatus = 'STABLE' | 'STAGED' | 'LOCKED' | 'ALERT';

/**
 * 节点类型枚举（星座拓扑四分派）
 */
export type NodeType = 'HUB' | 'RELAY' | 'PROBE' | 'SCANNER';

/**
 * LOCKED 固化定格五维快照结构
 */
export interface LockedSnapshot {
  rotationAngle: number;     // L2 轨道珠链冻结转角（rad）
  quantizedArcIndex: number; // L5 活性内环 8 档量化索引（0..7）
  arcLength: number;         // L5 冻结时的精确弧长/段数（rad）
  coreAlpha: number;         // L6 内核发光亮度（0.55..1.0）
  breathPhase: number;       // L6 冻结时的呼吸波相位（0..2π）
  connectionCount: number;   // L2 冻结刻度点亮珠数（0..12）
  timestamp: number;         // 固化时刻时间戳
}

/**
 * 空间中继节点核心实体
 */
export interface RelayNode {
  id: string;
  name: string;
  type: NodeType;
  status: NodeStatus;
  
  // 空间拓扑坐标（设计基准 1440x900，保持 coords/baseCoords 格式）
  coords: [number, number];       // 当前实时坐标（受物理弹簧/拖拽驱动）
  baseCoords: [number, number];   // 拓扑锚定基准坐标
  
  // 拓扑连接容量
  connectionCount: number;        // 当前有效连线数（0..12+）
  
  // 四通道物理遥测指标（严格映射异构 2.5D 几何）
  velocity: number;               // 0 ~ 40 km/s -> L2 珠链公转转速 (0.5..4 RPM)
  signalPower: number;            // -120 ~ -40 dBm -> L5 脉冲短弧激活段数与总跨度 (30°..330°)
  payloadCapacity: number;        // 0.0 ~ 1.0 -> L6 核心反应发光亮度与光斑 (alpha 0.55..1.0)
  latency: number;                // 0 ~ 100 ms -> 示波器波形频率偏移
  
  // 固化快照（仅在 status === 'LOCKED' 时存在）
  lockedSnapshot?: LockedSnapshot;
  
  // 扇区层级归属路径
  sectorId: string;
  galaxyId: string;
}

/**
 * 空间拓扑连线实体
 */
export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  bandwidth: number;              // 0.0 ~ 1.0（影响线宽与粒子密度）
  isVirtual?: boolean;            // STAGE1/STAGE2 虚拟推演连线
}

/**
 * 扇区节点（树形面包屑第二层）
 */
export interface SectorNode {
  id: string;
  name: string;
  galaxyId: string;
  nodeIds: string[];
}

/**
 * 星系层级根实体（树形面包屑第一层）
 */
export interface GalaxyHierarchy {
  id: string;
  name: string;
  sectorIds: string[];
}
```

---

## 3. 图层绘制规格与异构精密皮肤（Layer Drawing Spec）

所有层统一在 **35° 俯视透视（$k=0.82$）** 与 **左上 45° 固定光源（入射角 135°，仰角 45°）** 体系下建模：

### 3.1 尺寸基准表（根据 NodeType 缩放）

| 几何参数 | HUB 枢纽 | RELAY 中继 | PROBE 探测器 | SCANNER 扫描器 | 说明 |
|----------|----------|------------|--------------|----------------|------|
| **外径长半轴 $R_{\text{outer}}$** | 8.0 px | 7.0 px | 5.0 px | 6.0 px | 节点最大包围基准 |
| **短半轴 $R_y = R_{\text{outer}} \times 0.82$** | 6.56 px | 5.74 px | 4.10 px | 4.92 px | 全局 35° 俯视压缩 |
| **L4 装甲开口长半轴 $R_{\text{L4\_hole}}$** | 4.40 px | 3.85 px | 2.75 px | 3.30 px | $R_{\text{outer}} \times 0.55$ |
| **L1 能量板外径 $R_{\text{L1\_outer}}$** | 9.20 px | 8.05 px | 5.75 px | 6.90 px | $R_{\text{outer}} \times 1.15$ |
| **L1 能量板内径 $R_{\text{L1\_inner}}$** | 4.64 px | 4.06 px | 2.90 px | 3.48 px | $R_{\text{outer}} \times 0.58$ |

---

### 3.2 七层详细异构材质与几何着色规格

```
====================================================================================================
L1 护盾层 (Shield): 6 段非连续弧形能量板拼接 (D31 / 明确旋转中心)
====================================================================================================
• 几何：6 段弧形能量板（每段 52°）+ 6 处 8° 微裂隙断口，合计 360° 封闭。内径 R_L1_inner，外径 R_L1_outer。
• 旋转中心角度：6 段在 Canvas 上的旋转中心角严格固定为：
  0°、60°、120°、180°、240°、300°（每段覆盖该角度两侧 ±26°，保留 8° 裂隙）
• 材质与颜色：
  - STABLE：微光呼吸，基色 #00F0FF，alpha 0.08，外缘 1.0px 软光晕
  - STAGED：提亮 ×2，基色 #00F0FF，alpha 0.16；外径单向向外扩大 1.0px (R_L1_outer + 1.0px)，内径保持不变
  - LOCKED：固化常亮，基色 #3FB950，alpha 0.15 坚固常亮（不脉动）
  - ALERT：品红碎裂，基色 #FF0055，alpha 0.35 带 2.5D 扁圆涟漪波
• 光照：左上 135° 弧段高光提亮，右下 315° 弧段渐隐至 alpha 0.02

====================================================================================================
L2 轨道环 (Orbit Ring): 12 个 2.0px 独立金属刻度珠 (D29 / 方案 B 位置点亮 + 方案 A 珠链公转)
====================================================================================================
• 结构实现：
  1. 静态导轨 Sprite (L2_{type}_ALL_rail)：半径 R_L2 = R_outer * 0.95，厚度 0.8px，顶面渐变 #484F58 -> #21262D
  2. 独立金属珠 Sprite：
     - L2_ALL_ALL_bead_off：暗态金属珠（基色 #30363D，球冠高光）
     - L2_ALL_ALL_bead_on_cyan：青色亮珠（基色 #00F0FF，高光发光核）
     - L2_ALL_ALL_bead_on_green：固化绿亮珠（基色 #3FB950，高光发光核）
  3. 固定投影贴片 (L2_ALL_ALL_shadow)：偏移 (dx=+0.8px, dy=+0.8px)，模糊 1.5px，rgba(0,0,0,0.45) 静态固定于 L4 顶面
• 运行时位置点亮与公转算法（语义方案 B）：
  导轨轨道上定义 12 个绝对空间刻度槽（槽索引 slot = 0..11，角度 slotAngle = slot * (2*PI/12)）。
  前 activeCount (connectionCount) 个槽处于"激活导通态"。
  12 颗珠子随时间整体公转：theta_i = rotAngle + i * (2*PI/12)。
  对于第 i 颗珠子，找到与其当前 theta_i 最近的绝对刻度槽。若该刻度槽为激活槽，则该珠呈现亮态，否则暗态。
  珠子滑入激活槽区间即点亮，滑出即熄灭。LOCKED 状态下使用 bead_on_green，其余使用 bead_on_cyan。

====================================================================================================
L3 桁架层 (Truss): X 型交叉网架 + 中心加固节点盘 + 4 支撑方柱 (D32)
====================================================================================================
• 几何：中心加固节点盘（半径 R_L3_hub = R_L4_hole * 0.45）+ 4 根 X 型交叉斜桁架（宽 0.8px）+ 4 个支撑方柱 (0.8x0.8px)
• 材质与颜色：
  - 金属网架：#30363D，高光棱线 #6E7681 (0.5px)，支撑柱顶面提亮 #484F58
  - LOCKED 状态：锁死嵌光 #3FB950 + 铆钉点亮，alpha 0.90
• 渲染策略：STABLE 常态下仅中心加固节点盘显露于 L4 开口中；STAGED 下网架完全展开暴露

====================================================================================================
L4 装甲壳 (Armor Shell): 4 段不等宽阶梯搭接装甲瓦 (D27 / 明确角度与 2.5D 深度重排序)
====================================================================================================
• 4 段装甲精确角度与中心分布（合计 360°）：
  - Seg0（主装甲）：中心角 135°（左上迎光面），跨度 105°（82.5° ~ 187.5°）
  - Seg1（副装甲）：中心角 45°（右上面），跨度 65°（12.5° ~ 77.5°）
  - Seg2（主装甲）：中心角 315°（右下背光面），跨度 105°（262.5° ~ 367.5°/7.5°）
  - Seg3（副装甲）：中心角 225°（左下面），跨度 65°（192.5° ~ 257.5°）
  - 4 处搭接微缝：各 5°
• 状态与开壳时序：
  - STABLE 静态闭合：按搭接压盖顺序（Seg1 -> Seg2 -> Seg3 -> Seg0 最终覆盖）
  - STAGED 差速开壳（总基准 500ms）：
    主装甲 (Seg0/Seg2)：0 ~ 350ms 内翻转至 25°
    副装甲 (Seg1/Seg3)：延迟 120ms 启动，120 ~ 500ms 内翻转至 15°
  - STAGED 绘制顺序（2.5D Y轴深度重排序）：
    掀开后废除静态搭接顺时针，必须从最远端向最近端绘制以符合 2.5D 深度：
    1. Seg2（中心 315°，背光最远，Y 最小，先画）
    2. Seg1（中心 45°，侧翼后方）
    3. Seg3（中心 225°，侧翼前方）
    4. Seg0（中心 135°，迎光最近，Y 最大，最后画）
  - LOCKED：两段式咬合锁死，间隙收紧至 0.3px，嵌高光锁死线

====================================================================================================
L5 活性环 (Reactive Ring): 3-5 段独立脉冲点阵短弧 (D27 / 8 档离散组合参数表)
====================================================================================================
• 几何：半径 R_L5 = R_L4_hole * 0.90，厚度 0.5px。
• 动态排布：固定每段 45° + 间隙 15° 步进排布。根据 signalPower 动态截断激活绘制 3、4 或 5 段。
• 方案 C：8 档离散组合 Sprite（L5_ALL_LOCKED_q0..q7）参数表：
  - q0: 3 段短弧，总跨度 90°，起始角度 135°（极弱信号，-120 ~ -110 dBm）
  - q1: 3 段短弧，总跨度 150°，起始角度 105°（弱信号，-110 ~ -100 dBm）
  - q2: 3 段短弧，总跨度 210°，起始角度 75°（偏弱信号，-100 ~ -90 dBm）
  - q3: 4 段短弧，总跨度 180°，起始角度 90°（中等信号，-90 ~ -80 dBm）
  - q4: 4 段短弧，总跨度 240°，起始角度 60°（良好信号，-80 ~ -70 dBm）
  - q5: 4 段短弧，总跨度 270°，起始角度 45°（优良信号，-70 ~ -60 dBm）
  - q6: 5 段短弧，总跨度 300°，起始角度 30°（强信号，-60 ~ -50 dBm）
  - q7: 5 段短弧，总跨度 330°，起始角度 15°（满载极强信号，-50 ~ -40 dBm）

====================================================================================================
L6 核心反应舱 (Core): 外层多面体几何壳 + 内层高能脉冲光斑 (D30 / 实时光斑渲染归属)
====================================================================================================
• 几何与下沉三合一：
  1. 外层多面壳等比缩小至 L4 开口的 92%（R_L6 = R_L4_hole * 0.92）
  2. L4 井口内壁绘制 1.5px 渐变内阴影 rgba(0, 0, 0, 0.70)
  3. 透视下沉 dy = 1.64px，形成深井反应堆
• 渲染双层拆分：
  - 外层壳：离屏 Sprite blit (L6_{type}_{state}_shell)
  - 内层脉冲光斑：Canvas 实时绘制径向渐变（#E6FFFA -> #00F0FF），受复合呼吸 Alpha_breath * (1 + Noise_turb * 0.08) 驱动

====================================================================================================
L7 铭刻基底层 (Insignia): 微缩矩阵刻度面板 (D27)
====================================================================================================
• 几何：中心定位基底，位于最底层（Z-1）
• 结构与符号：3×3 状态微缩点阵（HUB/RELAY）或罗盘十字标线（PROBE/SCANNER），颜色 #8B949E（LOCKED 墨绿 #1F6FEB）
```

---

## 4. Sprite 工厂模块（src/core/nodeSpriteFactory.ts）

### 4.1 Sprite Key 统一命名规范与图集定义

全量统一为：`{layer}_{nodeType}_{state}_{variant}`

| 图层 | Sprite Key 结构与变体定义 | 条目数 |
|------|---------------------------|--------|
| **L1 护盾** | `L1_{HUB\|RELAY\|PROBE\|SCANNER}_{STABLE\|STAGED\|LOCKED\|ALERT}_seg` (单段 52° 模板，旋转 6 次 blit) | 16 |
| **L2 珠链** | `L2_{HUB\|RELAY\|PROBE\|SCANNER}_ALL_rail` (导轨) + `L2_ALL_ALL_bead_off` + `L2_ALL_ALL_bead_on_cyan` + `L2_ALL_ALL_bead_on_green` + `L2_ALL_ALL_shadow` (固定投影) | 8 |
| **L3 桁架** | `L3_{HUB\|RELAY\|PROBE\|SCANNER}_STABLE_hub` (常显中心盘) + `L3_{HUB\|RELAY\|PROBE\|SCANNER}_{STAGED\|LOCKED\|ALERT}_truss` (全开网架) | 16 |
| **L4 装甲** | `L4_{HUB\|RELAY\|PROBE\|SCANNER}_{STABLE\|LOCKED\|ALERT}_base` (闭合态) + `L4_{HUB\|RELAY\|PROBE\|SCANNER}_STAGED_segMain` / `segSub` (开壳主/副装甲) | 20 |
| **L5 活性环** | `L5_ALL_LOCKED_q0` 至 `L5_ALL_LOCKED_q7` (方案 C 8档参数贴片) + `L5_ALL_ACTIVE_seg` (单段 45° 模板) | 9 |
| **L6 内核壳** | `L6_{HUB\|RELAY\|PROBE\|SCANNER}_{STABLE\|STAGED\|LOCKED\|ALERT}_shell` (外多面壳，内层光斑实时画) | 16 |
| **L7 铭刻** | `L7_{HUB\|RELAY\|PROBE\|SCANNER}_{STABLE\|STAGED\|LOCKED\|ALERT}_base` (微缩矩阵面板) | 16 |
| **FX 粒子** | `FX_PARTICLE_ALL_{cyan\|amber\|magenta\|glow\|debris}` | 5 |
| **合计** | **总计预渲染图集条目数** | **106 条目** |

### 4.2 公开接口签名

```typescript
import { NodeType, NodeStatus } from '../types/domain';

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
 * 2.5D 异构 Sprite 工厂构建主入口
 * @param dpr 设备像素比（强制上限 2.0）
 * @returns 包含 106 条预渲染 Sprite 的不可变图集对象
 */
export function buildNodeSpriteSheet(dpr?: number): NodeSpriteSheet;
```

---

## 5. 粒子对象池模块（src/core/particlePool.ts）

### 5.1 公开接口签名

```typescript
export type ParticleType = 0 | 1 | 2 | 3 | 4; // 0:cyan, 1:amber, 2:magenta, 3:glow, 4:debris

export interface ParticlePool {
  spawn(x: number, y: number, vx: number, vy: number, maxLife: number, type: ParticleType): void;
  update(dt: number): void;
  getRenderData(): { count: number; data: Float32Array };
  clear(): void;
}

/**
 * 创建 512 颗固定容量的零 GC 粒子池
 */
export function createParticlePool(): ParticlePool;
```

---

## 6. 拓扑画布重构（src/components/topology/TopologyCanvas.tsx）

### 6.1 辅助函数定义与代码契约

```typescript
import { NodeType } from '../../types/domain';
import { SpriteEntry, NodeSpriteSheet } from '../../core/nodeSpriteFactory';

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
```

### 6.2 L2 珠链位置点亮与 L4 深度重排序核心逻辑

```typescript
// L2 珠链位置点亮公转绘制（方案 B + 方案 A）
export function drawBeadChain(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  spriteSheet: NodeSpriteSheet,
  rotAngle: number
) {
  const rX = getNodeRadius(node.type) * 0.95;
  const rY = rX * 0.82;
  const activeCount = node.status === 'LOCKED' 
    ? (node.lockedSnapshot?.connectionCount ?? node.connectionCount)
    : Math.min(12, Math.max(0, node.connectionCount));

  // 1. Blit 静态导轨与固定投影贴片
  drawStaticSprite(ctx, spriteSheet.get('L2_ALL_ALL_shadow'));
  drawStaticSprite(ctx, spriteSheet.get(`L2_${node.type}_ALL_rail`));

  // 2. 获取金属珠贴片
  const beadOff = spriteSheet.get('L2_ALL_ALL_bead_off');
  const beadOn = node.status === 'LOCKED'
    ? spriteSheet.get('L2_ALL_ALL_bead_on_green')
    : spriteSheet.get('L2_ALL_ALL_bead_on_cyan');

  // 3. 12 颗珠子位置判断（方案 B：空间刻度槽判定）
  for (let i = 0; i < 12; i++) {
    const theta = rotAngle + i * ((2 * Math.PI) / 12);
    const beadX = rX * Math.cos(theta);
    const beadY = rY * Math.sin(theta);

    // 计算珠子当前最接近的绝对刻度槽 (0..11)
    const normAngle = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const nearestSlot = Math.round(normAngle / ((2 * Math.PI) / 12)) % 12;

    const sprite = nearestSlot < activeCount ? beadOn : beadOff;
    if (sprite) {
      ctx.drawImage(sprite.canvas, beadX - sprite.anchorX, beadY - sprite.anchorY);
    }
  }
}

// L4 STAGED 态 2.5D 深度重排序绘制
export function drawStagedArmorSegments(
  ctx: CanvasRenderingContext2D,
  node: RelayNode,
  spriteSheet: NodeSpriteSheet,
  openProgress: number
) {
  const { mainAngle, subAngle } = computeArmorOpenProgress(openProgress);
  const mainSprite = spriteSheet.get(`L4_${node.type}_STAGED_segMain`);
  const subSprite = spriteSheet.get(`L4_${node.type}_STAGED_segSub`);

  // 2.5D Y轴深度从后往前排序（从上至下）：
  // 1. Seg2（中心 315°，背光最远，Y 最小，先画）
  // 2. Seg1（中心 45°，侧翼后方）
  // 3. Seg3（中心 225°，侧翼前方）
  // 4. Seg0（中心 135°，迎光最近，Y 最大，最后画）
  drawRotatedSprite(ctx, mainSprite, 315);
  drawRotatedSprite(ctx, subSprite, 45);
  drawRotatedSprite(ctx, subSprite, 225);
  drawRotatedSprite(ctx, mainSprite, 135);
}
```

### 6.3 拖拽四级视差跟随算法

```typescript
const parallaxState = {
  pL7: { x: 0, y: 0 }, // 质心先导 (lambda = 1.00)
  pL6: { x: 0, y: 0 }, // 反应舱内核 (lambda = 0.98)
  pL4: { x: 0, y: 0 }, // 装甲外壳与活性环 (lambda = 0.96)
  pL1: { x: 0, y: 0 }  // 悬浮能量板与珠链 (lambda = 0.94)
};

export function updateDragParallax(targetX: number, targetY: number) {
  parallaxState.pL7.x = targetX;
  parallaxState.pL7.y = targetY;

  parallaxState.pL6.x += (targetX - parallaxState.pL6.x) * 0.98;
  parallaxState.pL6.y += (targetY - parallaxState.pL6.y) * 0.98;

  parallaxState.pL4.x += (targetX - parallaxState.pL4.x) * 0.96;
  parallaxState.pL4.y += (targetY - parallaxState.pL4.y) * 0.96;

  parallaxState.pL1.x += (targetX - parallaxState.pL1.x) * 0.94;
  parallaxState.pL1.y += (targetY - parallaxState.pL1.y) * 0.94;

  const clampOffset = (layer: { x: number; y: number }) => {
    const dx = layer.x - targetX;
    const dy = layer.y - targetY;
    const dist = Math.hypot(dx, dy);
    if (dist > 1.2) {
      layer.x = targetX + (dx / dist) * 1.2;
      layer.y = targetY + (dy / dist) * 1.2;
    }
  };

  clampOffset(parallaxState.pL6);
  clampOffset(parallaxState.pL4);
  clampOffset(parallaxState.pL1);
}
```

---

## 7. 数据映射与异常分级计算

```typescript
export function computeNodeVisualParams(node: RelayNode, time: number) {
  // 1. 通道 1: L2 刻度珠点亮数 (0..12)
  const activeTicks = node.status === 'LOCKED'
    ? (node.lockedSnapshot?.connectionCount ?? node.connectionCount)
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

  // 4. 通道 4: L2 珠链公转转速
  const rpm = node.status === 'LOCKED' ? 0 : (0.5 + (node.velocity / 40) * 3.5);
  const angularVelocity = (rpm * 2 * Math.PI) / 60;

  // 5. L4 板缝异常分级计算
  const isSevereAlert = node.status === 'ALERT' || node.payloadCapacity >= 0.95 || node.signalPower <= -110;
  const isMildAlert = !isSevereAlert && (node.payloadCapacity >= 0.80 || node.signalPower <= -95);
  
  let seamWidth = 0.5;
  let seamAlphaMin = 0.10;
  let seamAlphaMax = 0.20;

  if (isSevereAlert) {
    seamWidth = 2.0;
    seamAlphaMin = 0.65;
    seamAlphaMax = 0.75;
  } else if (isMildAlert) {
    seamWidth = 1.0;
    seamAlphaMin = 0.30;
    seamAlphaMax = 0.40;
  }
  
  const seamAlpha = seamAlphaMin + (seamAlphaMax - seamAlphaMin) * (0.5 + 0.5 * Math.sin((2 * Math.PI * time) / 4.0));

  return { activeTicks, l5ArcAngle, quantizedArcIndex, activeSegmentCount, coreAlpha, angularVelocity, seamWidth, seamAlpha };
}
```

---

## 8. 浮卡重做（src/components/topology/NodeOverlayCard.tsx）

### 8.1 展示契约规范
- 节点全称与类型（如 `RELAY-2247 · 织女星中继`）
- **信号强度展示**：
  - 常态：`signalPower: -62.4 dBm ▸ 脉冲短弧 4/5 段 (跨度 187°)`
  - **LOCKED 固化态**：`signalPower: -62.4 dBm ▸ 脉冲短弧 4/5 段 (量化 4/8 档 · 固化冻结)`
- **负载与连接**：`payloadCapacity: 0.82 ▸ 反应舱发光 82%`、`connectionCount: 6/12 颗金属珠点亮`

---

## 9. 实施批次规划（重构安全版）

采用**骨架先行、逐步填充**的安全模式，彻底消除同一文件破坏性重写风险：

| 批次 | 目标文件 | 核心工作内容 | 验证命令 |
|------|----------|--------------|----------|
| **Batch 1** | `src/types/domain.ts` | 替换 `NodeStatus v2`，恢复 `coords`/`baseCoords`，完善 `LockedSnapshot` | `npx tsc --noEmit` |
| **Batch 2** | `src/services/mockDataGenerator.ts` | 产出 60 节点同心星座拓扑（5 HUB/15 RELAY/30 PROBE/10 SCANNER）与 142 边 | `npx tsc --noEmit` |
| **Batch 3** | `src/core/nodeSpriteFactory.ts` | 构建 106 条目异构 2.5D 精密材质图集（导轨+亮暗双色珠Sprite+L5 8档量化贴片） | `npx tsc --noEmit` |
| **Batch 4** | `src/core/particlePool.ts` | 实现 512 颗固定容量 `Float32Array` 零 GC 粒子池 | `npx tsc --noEmit` |
| **Batch 5** | `src/components/topology/TopologyCanvas.tsx` | **编写 Canvas 完整骨架**：接入 DPR/SpriteSheet/RAF 循环，放置 4 个空函数桩 | `npm run lint` |
| **Batch 6** | `src/components/topology/TopologyCanvas.tsx` | **填充 `drawStaticNodes`**：59 节点 Z-order Blit、L2 位置点亮公转、L6 实时光斑 | `npm run lint` |
| **Batch 7** | `src/components/topology/TopologyCanvas.tsx` | **填充 `drawParticles` + `drawActiveNode`**：粒子 blit、L4 深度排序掀开、4 级视差 | `npm run lint` |
| **Batch 8** | `src/components/topology/TopologyCanvas.tsx` & `NodeOverlayCard.tsx` | **填充 `drawLabels` 与浮卡**：演示标签模式、LOCKED 快照读取、浮卡异构指标展示 | `npx tsc --noEmit` |
| **Batch 9** | `src/App.tsx` & 整体联调 | `COMMITTED` 固化快照分发、键盘矩阵联动、全系统 60fps 帧率验证与打包验证 | `npm run build` |

---

*v1.3 施工文档消除了所有接口与绘制细节的盲区，实现了 L2 双色亮珠独立 Sprite、L5 8 档参数具体化、L1 6 段精确旋转角、基础绘图函数契约化、以及 L4 STAGED 态 2.5D 深度重排序，为工程编码提供终极落地的无歧义指南。*
