import { RelayNode, TopologyEdge, SectorNode, GalaxyHierarchy, NodeType } from '../types/domain';

/** generateConstellationTopology 的完整返回结构 */
export interface MockTopologyData {
  nodes: Record<string, RelayNode>;
  edges: TopologyEdge[];
  sectors: SectorNode[];
  galaxy: GalaxyHierarchy;
}

/** 目标边总数（与旧拓扑规模保持一致） */
const TARGET_EDGE_COUNT = 142;

/** 固定 ID：初始选中节点，必须存在于 RELAY 层 */
const PRIMARY_NODE_ID = 'RELAY-2247';

/** 根系星系元信息 */
const GALAXY_ID = 'KEPLER-90';
const GALAXY_NAME = '开普勒-90 主星系';

/** 八个扇区（树形面包屑第二层），节点按 id 哈希取模归入扇区，保证四类型混布 */
const SECTOR_DEFS: { id: string; name: string }[] = [
  { id: 'SECTOR-01', name: '奥尔特前哨' },
  { id: 'SECTOR-02', name: '柯伊伯中继带' },
  { id: 'SECTOR-03', name: '主小行星场' },
  { id: 'SECTOR-04', name: '深空扫描弧' },
  { id: 'SECTOR-05', name: '轨道交汇区' },
  { id: 'SECTOR-06', name: '长弧滞后区' },
  { id: 'SECTOR-07', name: '核心定轨中继区' },
  { id: 'SECTOR-08', name: '极远端信标' },
];

/**
 * 四层同心环带规格：
 * 层半径严格对齐 v1.8 PRD §6.1 —— HUB 20~40% / RELAY 40~70% / PROBE 70~90% / SCANNER 90~100%
 * 节点数 5 / 15 / 30 / 10，合计 60
 */
const RING_SPECS: { type: NodeType; count: number; rMin: number; rMax: number }[] = [
  { type: 'HUB', count: 5, rMin: 20, rMax: 40 },
  { type: 'RELAY', count: 15, rMin: 40, rMax: 70 },
  { type: 'PROBE', count: 30, rMin: 70, rMax: 90 },
  { type: 'SCANNER', count: 10, rMin: 90, rMax: 100 },
];

/* ============================== 确定性伪随机 ============================== */

/**
 * nodeId -> [0,1) 确定性哈希
 * 用于替代 Math.random()，保证 HMR / 刷新后拓扑与遥测指标完全一致
 */
function hash01(nodeId: string): number {
  let h = 2166136261;
  for (let i = 0; i < nodeId.length; i++) {
    h ^= nodeId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** 在 [min, max) 区间内取确定性伪随机值 */
function hashRange(nodeId: string, min: number, max: number, salt: string): number {
  return min + hash01(`${nodeId}#${salt}`) * (max - min);
}

/* ============================== 坐标生成 ============================== */

const clampCoord = (v: number): number => Math.min(95, Math.max(5, v));

/**
 * 生成同心星座坐标（[x, y] 元组，百分比坐标系，圆心 50,50）
 * 在所属环带内均匀分布，再叠加基于 id 的确定性微扰，避免几何上过于规则
 */
function buildCoords(
  nodeId: string,
  tierIndex: number,
  indexInTier: number,
  spec: { count: number; rMin: number; rMax: number }
): [number, number] {
  const rBase = spec.rMin + (spec.rMax - spec.rMin) * (indexInTier / spec.count);
  const rJittered = rBase + hashRange(nodeId, -3, 3, 'r-jitter');
  const r = (rJittered + spec.rMin) / 2; // 抖动后仍收敛在环带内

  const angleBase = (indexInTier / spec.count) * Math.PI * 2;
  const angle = angleBase + tierIndex * 0.31 + hashRange(nodeId, -0.08, 0.08, 'a-jitter');

  const x = clampCoord(50 + Math.cos(angle) * r);
  const y = clampCoord(50 + Math.sin(angle) * r);
  return [x, y];
}

/**
 * 扇区归属：以 id 哈希取模落位，使八个扇区各自都含多种节点类型
 */
function pickSector(nodeId: string): { id: string; name: string } {
  const idx = Math.floor(hash01(`${nodeId}#sector`) * SECTOR_DEFS.length) % SECTOR_DEFS.length;
  return SECTOR_DEFS[idx];
}

/* ============================== 主生成函数 ============================== */

export function generateConstellationTopology(): MockTopologyData {
  /* ---------- 第 1 步：按四层环带生成 60 个节点 ---------- */
  const nodes: Record<string, RelayNode> = {};
  const allIds: string[] = [];

  RING_SPECS.forEach((spec, tierIndex) => {
    for (let i = 0; i < spec.count; i++) {
      // RELAY 层首位固定为 RELAY-2247，其余按 {TYPE}-{4位序号} 递增
      let id: string;
      if (spec.type === 'RELAY' && i === 0) {
        id = PRIMARY_NODE_ID;
      } else {
        id = `${spec.type}-${String(i + 1).padStart(4, '0')}`;
      }

      const sector = pickSector(id);
      const [x, y] = buildCoords(id, tierIndex, i, spec);

      nodes[id] = {
        id,
        name: `${spec.type} · ${id}`,
        type: spec.type,
        // 初始全部为 STABLE，STAGED / LOCKED / ALERT 由运行时状态机驱动
        status: 'STABLE',
        coords: [x, y],
        baseCoords: [x, y],
        // 真实度数在第 3 步由 edges 反算覆盖
        connectionCount: 0,
        // 四通道遥测：均由 id 哈希确定性生成
        velocity: hashRange(id, 5, 35, 'velocity'),
        signalPower: hashRange(id, -110, -50, 'signal'),
        payloadCapacity: hashRange(id, 0.2, 0.9, 'payload'),
        latency: hashRange(id, 2, 80, 'latency'),
        sectorId: sector.id,
        galaxyId: GALAXY_ID,
      };
      allIds.push(id);
    }
  });

  /* ---------- 第 2 步：构造 142 条边 ---------- */
  const edges: TopologyEdge[] = [];
  const edgeKeys = new Set<string>();
  const dist = (a: RelayNode, b: RelayNode): number =>
    Math.hypot(a.baseCoords[0] - b.baseCoords[0], a.baseCoords[1] - b.baseCoords[1]);

  /** 去重写入：同一对节点只保留一条边（无向去重 + 防自环） */
  const addEdge = (a: string, b: string, bandwidth: number): boolean => {
    if (a === b) return false;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    edges.push({ id: `edge-${edges.length + 1}`, source: a, target: b, bandwidth });
    return true;
  };

  // 2a. 同类型邻近连接：每层内「一环 + 二环」闭环，保证无孤立节点
  //     HUB 5 + RELAY 15 + PROBE 30 + SCANNER 10 = 60 条一环边 + 65 条二环边 = 125 条
  RING_SPECS.forEach((spec) => {
    const tierIds = allIds.filter((id) => nodes[id].type === spec.type);
    const n = tierIds.length;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      addEdge(tierIds[i], tierIds[(i + 1) % n], 0.5);
    }
    if (n >= 3) {
      for (let i = 0; i < n; i++) {
        addEdge(tierIds[i], tierIds[(i + 2) % n], 0.5);
      }
    }
  });

  // 2b. 强主干边：RELAY-2247 -> 3 个 HUB，bandwidth 1.0
  const hubTier = RING_SPECS.find((s) => s.type === 'HUB')!;
  allIds
    .filter((id) => nodes[id].type === 'HUB')
    .sort((a, b) => dist(nodes[a], nodes[PRIMARY_NODE_ID]) - dist(nodes[b], nodes[PRIMARY_NODE_ID]))
    .slice(0, Math.min(3, hubTier.count))
    .forEach((hubId) => addEdge(PRIMARY_NODE_ID, hubId, 1.0));

  // 2c. 跨类型连接：按几何距离由近及远补足到 142 条，bandwidth 0.2
  //     （同类型邻近连接已优先占满，跨类型只作少量补充）
  const crossCandidates: { a: string; b: string; d: number }[] = [];
  for (let i = 0; i < allIds.length; i++) {
    for (let j = i + 1; j < allIds.length; j++) {
      const a = allIds[i];
      const b = allIds[j];
      if (nodes[a].type === nodes[b].type) continue;
      crossCandidates.push({ a, b, d: dist(nodes[a], nodes[b]) });
    }
  }
  crossCandidates.sort((p, q) => p.d - q.d);
  for (const cand of crossCandidates) {
    if (edges.length >= TARGET_EDGE_COUNT) break;
    addEdge(cand.a, cand.b, 0.2);
  }

  // 2d. 兜底：候选耗尽仍未达标时，按全局几何距离继续补边（保证连通性）
  if (edges.length < TARGET_EDGE_COUNT) {
    const rest: { a: string; b: string; d: number }[] = [];
    for (let i = 0; i < allIds.length; i++) {
      for (let j = i + 1; j < allIds.length; j++) {
        rest.push({ a: allIds[i], b: allIds[j], d: dist(nodes[allIds[i]], nodes[allIds[j]]) });
      }
    }
    rest.sort((p, q) => p.d - q.d);
    for (const cand of rest) {
      if (edges.length >= TARGET_EDGE_COUNT) break;
      addEdge(cand.a, cand.b, 0.2);
    }
  }

  // 2e. 孤立节点兜底：任何度数为 0 的节点就近连一条边
  const degreeCount: Record<string, number> = {};
  allIds.forEach((id) => { degreeCount[id] = 0; });
  edges.forEach((e) => {
    degreeCount[e.source] += 1;
    degreeCount[e.target] += 1;
  });
  allIds.forEach((id) => {
    if (degreeCount[id] > 0) return;
    const nearest = allIds
      .filter((other) => other !== id)
      .sort((a, b) => dist(nodes[id], nodes[a]) - dist(nodes[id], nodes[b]))[0];
    if (nearest) addEdge(id, nearest, 0.2);
  });

  /* ---------- 第 3 步：从 edges 反算 connectionCount（不硬编码） ---------- */
  const finalDegree: Record<string, number> = {};
  allIds.forEach((id) => { finalDegree[id] = 0; });
  edges.forEach((e) => {
    finalDegree[e.source] = (finalDegree[e.source] ?? 0) + 1;
    finalDegree[e.target] = (finalDegree[e.target] ?? 0) + 1;
  });
  allIds.forEach((id) => {
    nodes[id].connectionCount = finalDegree[id] ?? 0;
  });

  /* ---------- 第 4 步：组装扇区与星系层级 ---------- */
  const sectors: SectorNode[] = SECTOR_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    galaxyId: GALAXY_ID,
    nodeIds: allIds.filter((id) => nodes[id].sectorId === def.id),
  }));

  const galaxy: GalaxyHierarchy = {
    id: GALAXY_ID,
    name: GALAXY_NAME,
    sectorIds: sectors.map((s) => s.id),
  };

  return { nodes, edges, sectors, galaxy };
}
