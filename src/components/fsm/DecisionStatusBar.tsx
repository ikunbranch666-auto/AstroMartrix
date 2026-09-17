import React from 'react';
import { DecisionState, FSMPhase } from '../../types/fsm';

/** phase 中文映射与主题色：稳态青 / 推演黄 / 决断琥珀 / 固化绿 / 熔断品红 */
const PHASE_META: Record<FSMPhase, { label: string; color: string }> = {
  STABLE_IDLE: { label: '稳态待命', color: '#00F0FF' },
  STAGE1_SIMULATION: { label: '全息推演', color: '#FACC15' },
  STAGE2_DECISION: { label: '决断窗口', color: '#F59E0B' },
  COMMITTED: { label: '已固化', color: '#3FB950' },
  AUTO_ABORT: { label: '熔断回弹', color: '#FF0055' },
};

export const DecisionStatusBar: React.FC<{ state: DecisionState }> = ({ state }) => {
  const meta = PHASE_META[state.phase];

  return (
    <div
      role="status"
      aria-label={`当前状态：${meta.label}`}
      className="flex items-center gap-3 font-data"
    >
      {/* 双层切角 badge：外层 1px 边框光随 phase 变色，内层保持面板底色 */}
      <div className="chamfer-frame-sm" style={{ background: `${meta.color}59` }}>
        <div className="chamfer-inner flex items-center gap-3 px-4 py-2">
          <span
            className="h-2 w-2 shrink-0"
            style={{ backgroundColor: meta.color }}
            aria-hidden="true"
          />
          <span className="text-[10px] tracking-[0.2em] text-[#8B949E]">SYS.PHASE</span>
          <span className="text-sm font-bold tracking-wider" style={{ color: meta.color }}>
            {meta.label}
          </span>

          {/* 阶段一：20s 推演倒计时 (黄色常规字号) */}
          {state.phase === 'STAGE1_SIMULATION' && (
            <span className="text-sm font-bold tabular-nums text-[#FACC15]">
              T-{state.stage1TimeRemaining.toFixed(1)}s
            </span>
          )}

          {/* 阶段二：10s 决断大字红色倒计时 */}
          {state.phase === 'STAGE2_DECISION' && (
            <span className="text-xl font-bold tabular-nums text-[#FF0055]">
              {state.stage2TimeRemaining.toFixed(1)}s
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
