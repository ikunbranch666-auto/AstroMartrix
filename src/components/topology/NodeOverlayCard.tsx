import React from 'react';
import { RelayNode } from '../../types/domain';

/**
 * 选中节点浮动遥测卡（施工文档 v1.3 §8 重做）
 *
 * 纯展示组件：给定 node / position / visible 即渲染，无副作用、不订阅 MatrixEngine、无内部状态。
 * 由 Batch 9 的 App.tsx 决定渲染时机与 position 来源。
 */

export interface NodeOverlayCardProps {
  node: RelayNode | null;
  position: { x: number; y: number } | null; // 相对容器的 CSS 像素坐标
  visible: boolean;
}

/* ================================ §7 视觉参数映射（与画布同源公式，仅用于文案派生） ================================ */

/** 通道2：L5 脉冲短弧的激活段数（3..5）与总跨度（rad） */
function computeArcParams(node: RelayNode): { segmentCount: number; quantizedIndex: number; spanDeg: number } {
  if (node.status === 'LOCKED' && node.lockedSnapshot) {
    const quantizedIndex = node.lockedSnapshot.quantizedArcIndex;
    return {
      segmentCount: 3 + Math.floor((quantizedIndex / 7) * 2),
      quantizedIndex,
      spanDeg: Math.round((node.lockedSnapshot.arcLength * 180) / Math.PI),
    };
  }
  const normSignal = Math.max(0, Math.min(1, (node.signalPower + 120) / 80));
  return {
    segmentCount: 3 + Math.floor(normSignal * 2.99), // 3, 4, 5 段
    quantizedIndex: Math.min(7, Math.floor(normSignal * 8)),
    spanDeg: Math.round(30 + normSignal * 300),
  };
}

/** 通道4：L2 珠链公转转速（RPM）；LOCKED 冻结为 0 */
function computeRpm(node: RelayNode): number {
  return node.status === 'LOCKED' ? 0 : 0.5 + (node.velocity / 40) * 3.5;
}

/* ================================ 组件 ================================ */

export const NodeOverlayCard: React.FC<NodeOverlayCardProps> = ({ node, position, visible }) => {
  if (!node || !visible || !position) return null;

  const isLocked = node.status === 'LOCKED';
  // LOCKED 态数值统一走固化绿，其余走主数据青
  const valueColor = isLocked ? '#3FB950' : '#00F0FF';
  const arc = computeArcParams(node);
  const rpm = computeRpm(node);
  const litBeads = isLocked
    ? node.lockedSnapshot?.connectionCount ?? node.connectionCount
    : Math.min(12, Math.max(0, node.connectionCount));

  // 信号行尾注：LOCKED 追加量化档位与冻结说明
  const arcTail = isLocked
    ? `量化 ${arc.quantizedIndex}/8 档 · 固化冻结`
    : `跨度 ${arc.spanDeg}°`;

  const labelStyle: React.CSSProperties = { color: '#8B949E' };
  const valueStyle: React.CSSProperties = { color: valueColor };

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: position.x, top: position.y }}
    >
      <div className="chamfer-frame-sm bg-[#00F0FF]/20">
        <div className="chamfer-inner p-3 font-data backdrop-blur-md" style={{ minWidth: 240 }}>
          {/* 头部：节点 ID + name + 类型徽章 */}
          <div className="flex items-center justify-between gap-3 border-b border-[#21262D] pb-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[12px] font-bold tracking-wider" style={{ color: valueColor }}>
                {node.id}
              </span>
              <span className="text-[10px] truncate" style={labelStyle} title={node.name}>
                {node.name}
              </span>
            </div>
            <span
              className="shrink-0 px-1.5 py-0.5 text-[10px] tracking-wider chamfer-sm"
              style={{ color: valueColor, backgroundColor: `${valueColor}1A` }}
            >
              {node.type}
            </span>
          </div>

          {/* 遥测明细 */}
          <div className="mt-2 space-y-1 text-[10px] leading-relaxed">
            <p className="flex justify-between gap-3">
              <span style={labelStyle}>signalPower:</span>
              <span className="text-right">
                <span style={valueStyle}>{node.signalPower.toFixed(1)} dBm</span>
                <span style={labelStyle}>
                  {' ▸ '}脉冲短弧 {arc.segmentCount}/5 段 ({arcTail})
                </span>
              </span>
            </p>

            <p className="flex justify-between gap-3">
              <span style={labelStyle}>payloadCapacity:</span>
              <span className="text-right">
                <span style={valueStyle}>{node.payloadCapacity.toFixed(2)}</span>
                <span style={labelStyle}>
                  {' ▸ '}反应舱发光 {Math.round(node.payloadCapacity * 100)}%
                </span>
              </span>
            </p>

            <p className="flex justify-between gap-3">
              <span style={labelStyle}>connectionCount:</span>
              <span className="text-right">
                <span style={valueStyle}>{litBeads}/12</span>
                <span style={labelStyle}>{' 颗金属珠点亮'}</span>
              </span>
            </p>

            <p className="flex justify-between gap-3">
              <span style={labelStyle}>velocity:</span>
              <span className="text-right">
                <span style={valueStyle}>{node.velocity.toFixed(1)} km/s</span>
                <span style={labelStyle}>
                  {' ▸ '}珠链公转 {rpm.toFixed(1)} RPM
                </span>
              </span>
            </p>

            <p className="flex justify-between gap-3">
              <span style={labelStyle}>latency:</span>
              <span style={valueStyle}>{node.latency.toFixed(1)} ms</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
