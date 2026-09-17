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

/**
 * QoS 三档画质性能分级
 * 被 MatrixEngine.ts 消费（不在本批次重做范围）
 */
export type QoSTier = 'TIER_1_QUALITY' | 'TIER_2_BALANCED' | 'TIER_3_PERFORMANCE';

/**
 * 二维空间坐标（对象形式）
 * 被 fsm.ts 的 targetCoords 等消费
 * 注意：RelayNode.coords 使用元组形式 [number, number]，与此不冲突
 */
export interface SpatialCoords {
  x: number;
  y: number;
}
