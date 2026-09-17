import React, { useEffect, useState } from 'react';
import { MatrixProvider, useMatrixState, useMatrixActions } from './context/MatrixContext';
import { generateConstellationTopology, MockTopologyData } from './mocks/mockDataGenerator';
import { LockedSnapshot } from './types/domain';
import { computeNodeVisualParams } from './components/topology/TopologyCanvas';

import { InterlockingBreadcrumb } from './components/shell/InterlockingBreadcrumb';
import { DecisionStatusBar } from './components/fsm/DecisionStatusBar';
import { TopologyCanvas } from './components/topology/TopologyCanvas';
import { DeepSpaceBackground } from './components/topology/DeepSpaceBackground';
import { TelemetryScope } from './components/telemetry/TelemetryScope';
import { HeatIndexMeter } from './components/telemetry/HeatIndexMeter';
import { KeyboardMatrix } from './components/fsm/KeyboardMatrix';

/** 从 Record<string, RelayNode> 中按 id 取节点（避免直接下标读取带来的隐式 any） */
function pickNode(data: MockTopologyData, nodeId: string | null) {
  if (nodeId && data.nodes[nodeId]) return data.nodes[nodeId];
  const ids = Object.keys(data.nodes);
  return ids.length > 0 ? data.nodes[ids[0]] : null;
}

const AstroMatrixLayout: React.FC = () => {
  const state = useMatrixState();
  const actions = useMatrixActions();

  // 显式标注泛型：保证 setData 的函数式更新参数自动推断为 MockTopologyData
  const [data, setData] = useState<MockTopologyData>(() => generateConstellationTopology());
  const selectedNode = pickNode(data, state.selectedNodeId);

  // 固化完成 (COMMITTED)：把选中节点固化为 LOCKED，并写入 7 字段定格快照（施工文档 §2.1 LockedSnapshot）
  // rotationAngle / breathPhase 为可接受近似（架构约束：不为此新增 Props 通道）
  useEffect(() => {
    if (state.phase !== 'COMMITTED') return;
    const nodeId = state.selectedNodeId;
    if (!nodeId) return;

    // 固化位置真值源：FSM 的 targetCoords（由画布松手前最后一次 onDragNode 写入）。
    // 不能用 data.nodes[nodeId].coords —— 那是拖拽开始前的旧值，会导致固化后节点跳回原位。
    const targetCoords = state.targetCoords;
    const dragged = data.nodes[nodeId];
    if (!dragged) return;

    const timeSec = performance.now() / 1000;
    const visual = computeNodeVisualParams(dragged, timeSec);

    const snapshot: LockedSnapshot = {
      // 珠链公转相位近似：以当前时间 × 角速度积分（LOCKED 判定发生在固化瞬间）
      rotationAngle: timeSec * visual.angularVelocity,
      quantizedArcIndex: visual.quantizedArcIndex,
      arcLength: visual.l5ArcAngle,
      coreAlpha: visual.coreAlpha,
      // 呼吸波相位：与 computeNodeVisualParams 的 4 秒周期对齐
      breathPhase: ((2 * Math.PI * timeSec) / 4.0) % (2 * Math.PI),
      connectionCount: dragged.connectionCount,
      timestamp: Date.now(),
    };

    setData(prev => {
      const node = prev.nodes[nodeId];
      if (!node) return prev;
      // 优先固化到拖拽终点；缺失时回落到当前坐标（兜底，不应发生）
      const fx = targetCoords ? targetCoords.x : node.coords[0];
      const fy = targetCoords ? targetCoords.y : node.coords[1];
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            status: 'LOCKED',
            // 拓扑结构永久更新：拖拽终点即新的锚定基准
            coords: [fx, fy],
            baseCoords: [fx, fy],
            lockedSnapshot: snapshot,
          },
        },
      };
    });
    // 依赖刻意不含 data.nodes：仅需在进入 COMMITTED 的那一刻固化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.selectedNodeId, state.targetCoords]);

  // 扇区名适配：SectorNode 为 { id, name, galaxyId, nodeIds }
  const sectorName = selectedNode
    ? data.sectors.find(s => s.id === selectedNode.sectorId)?.name ?? '未知扇区'
    : '未知扇区';

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#06080B] text-[#F0F6FC] font-sans flex flex-col">
      {/* 极坐标背景层 (Layer 0) */}
      <DeepSpaceBackground />

      {/* 顶部控制栏 (Top Bar - 64px) */}
      <header className="relative z-30 flex h-16 w-full shrink-0 items-center justify-between border-b border-[#21262D] bg-[#0D1117]/85 px-6 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <h1 className="font-data text-base font-bold tracking-widest text-[#00F0FF] flex items-center gap-2">
            <span className="h-3 w-3 bg-[#00F0FF] chamfer-sm"></span>
            ASTROMATRIX
          </h1>
          {/* 45° 梯形咬合面包屑 (带 min-w 保护) */}
          {selectedNode && (
            <InterlockingBreadcrumb
              galaxyName={data.galaxy.name}
              sectorName={sectorName}
              nodeName={selectedNode.id}
              phase={state.phase}
            />
          )}
        </div>

        {/* 决策状态机与倒计时 */}
        <DecisionStatusBar state={state} />
      </header>

      {/* 中部核心交互视界 (Central Viewport - Flex 1) */}
      <main className="relative z-20 flex-1 w-full overflow-hidden flex">
        {/* 左侧悬浮 HUD：热负荷指数计量仪 (内部直连 MatrixEngine) */}
        <aside className="absolute left-6 top-6 z-30 w-72 pointer-events-none">
          <HeatIndexMeter phase={state.phase} />
        </aside>

        {/* 空间拓扑主画布 (2.5D 异构渲染管线；heatLevel / qosTier 由画布内部订阅引擎获取) */}
        <section id="topology-viewport" className="relative h-full w-full">
          <TopologyCanvas
            nodes={data.nodes}
            edges={data.edges}
            selectedNodeId={state.selectedNodeId}
            phase={state.phase}
            onSelectNode={actions.selectNode}
            onDragNode={(nodeId, x, y) => {
              // reducer 守卫自行分流：首次调用落 START_SIMULATION，其后落 UPDATE_SIMULATION_COORDS
              actions.startSimulation(nodeId, { x, y });
              actions.updateCoords({ x, y });
            }}
            onEnterDecisionStage={actions.enterDecisionStage}
            onAbortDecision={() => actions.triggerAbort('USER_CANCEL')}
          />
        </section>

        {/* 右侧悬浮 HUD：定轨参数卡片 */}
        <aside className="absolute right-6 top-6 z-30 w-80 pointer-events-none">
          {selectedNode && (
            <div className="chamfer-frame-md bg-[#00F0FF]/20 pointer-events-auto">
              <div className="chamfer-inner p-4 font-data text-xs backdrop-blur-md">
                <div className="flex justify-between text-[#8B949E] border-b border-[#21262D] pb-2">
                  <span>TARGET ORBIT</span>
                  <span>目标轨道锁定</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  <p className="flex justify-between">
                    <span className="text-[#8B949E]">选中节点:</span>
                    <span className="text-[#00F0FF] font-bold">{selectedNode.id}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-[#8B949E]">节点类型:</span>
                    <span>{selectedNode.type}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-[#8B949E]">基准速度:</span>
                    <span>{selectedNode.velocity.toFixed(2)} KM/S</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-[#8B949E]">链路延迟:</span>
                    <span>{selectedNode.latency.toFixed(2)} MS</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-[#8B949E]">有效连线:</span>
                    <span>{selectedNode.connectionCount} 条</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-[#8B949E]">推演阶段:</span>
                    <span className={state.phase === 'STAGE2_DECISION' ? 'text-[#F59E0B]' : 'text-[#00F0FF]'}>
                      {state.phase}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* 底部遥测示波器带 (Telemetry Viewport - 176px) */}
      <footer className="relative z-30 flex h-44 w-full shrink-0 items-stretch border-t border-[#21262D] bg-[#0D1117]/90 backdrop-blur-md">
        <div className="flex w-60 shrink-0 flex-col justify-center border-r border-[#21262D] px-6 font-data">
          <p className="text-xs text-[#8B949E]">TELEMETRY OSCILLOSCOPE</p>
          <p className="mt-2 text-sm flex justify-between">
            <span className="text-[#8B949E]">CH-01 速度波:</span>
            <span className="text-[#00F0FF]">{selectedNode ? selectedNode.velocity.toFixed(2) : '--'} km/s</span>
          </p>
          <p className="mt-1 text-sm flex justify-between">
            <span className="text-[#8B949E]">CH-02 功率波:</span>
            <span className="text-[#F59E0B]">{selectedNode ? selectedNode.signalPower.toFixed(1) : '--'} dBm</span>
          </p>
        </div>

        {/* 双轨余辉示波器主体 (内部直连 MatrixEngine) */}
        <div className="relative flex-1 min-w-0">
          <TelemetryScope phase={state.phase} />
        </div>

        {/* 右侧全局键盘矩阵与无障碍 */}
        <div className="flex w-80 shrink-0 items-center justify-end border-l border-[#21262D] px-6">
          <KeyboardMatrix
            phase={state.phase}
            onCommit={actions.commitDecision}
            onAbort={() => actions.triggerAbort('USER_CANCEL')}
          />
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <MatrixProvider>
      <AstroMatrixLayout />
    </MatrixProvider>
  );
}
