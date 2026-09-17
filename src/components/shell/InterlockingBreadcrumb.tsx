import React from 'react';
import { FSMPhase } from '../../types/fsm';

interface InterlockingBreadcrumbProps {
  galaxyName: string;
  sectorName: string;
  nodeName: string;
  phase: FSMPhase;
}

/**
 * 末段高亮色随决策状态机流转 (纯静态映射，绝不订阅 MatrixEngine)
 * STAGE2_DECISION → 琥珀金 / AUTO_ABORT → 品红 / 其余 → 青色
 */
const ACTIVE_COLOR_MAP: Record<FSMPhase, string> = {
  STABLE_IDLE: '#00F0FF',
  STAGE1_SIMULATION: '#00F0FF',
  STAGE2_DECISION: '#F59E0B',
  COMMITTED: '#00F0FF',
  AUTO_ABORT: '#FF0055',
};

export const InterlockingBreadcrumb: React.FC<InterlockingBreadcrumbProps> = ({
  galaxyName,
  sectorName,
  nodeName,
  phase,
}) => {
  const activeColor = ACTIVE_COLOR_MAP[phase];

  return (
    <nav aria-label="空间层级路径" className="flex min-w-0 items-stretch font-data text-xs">
      {/* 第一段：主星系 (crumb-lead 左端直角起头) */}
      <span
        className="crumb-lead flex items-center bg-[#161B22] px-3 py-1.5 text-[#8B949E]"
        title="主星系"
      >
        {galaxyName}
      </span>
      {/* 第二段：扇区 (crumb-tooth 45° 双侧咬合) */}
      <span
        className="crumb-tooth flex items-center bg-[#0D1117] px-4 py-1.5 text-[#8B949E]"
        title="扇区"
      >
        {sectorName}
      </span>
      {/* 第三段：当前节点 (高亮，文字与背景随 phase 变色，背景注入 10% 透明度) */}
      <span
        className="crumb-tooth flex items-center px-4 py-1.5 font-bold tracking-wider"
        style={{ color: activeColor, backgroundColor: `${activeColor}1A` }}
        title="当前节点"
      >
        {nodeName}
      </span>
    </nav>
  );
};
