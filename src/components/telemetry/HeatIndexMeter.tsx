import React, { useEffect, useRef } from 'react';
import { FSMPhase } from '../../types/fsm';
import { MatrixEngine } from '../../engine/MatrixEngine';

export const HeatIndexMeter: React.FC<{ phase: FSMPhase }> = ({ phase }) => {
  const valueTextRef = useRef<HTMLParagraphElement | null>(null);
  const barFillRef = useRef<HTMLDivElement | null>(null);

  // 告警配色随决策阶段流转 (STAGE2 琥珀 / AUTO_ABORT 品红 / 其余青色)，
  // 经 Ref 透传进高频订阅回调，避免任何 React 重渲染
  const phaseRef = useRef<FSMPhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    // 高频 60Hz 订阅 MatrixEngine，直接操作 DOM
    // 采用 transform: scaleX() 代替 width%，只触发 Composite 不触发 Layout
    const unsubscribe = MatrixEngine.getInstance().subscribe(({ heatLevel }) => {
      if (valueTextRef.current) {
        valueTextRef.current.textContent = heatLevel.toFixed(2);
        valueTextRef.current.style.color = getAlarmColor(phaseRef.current);
      }
      if (barFillRef.current) {
        barFillRef.current.style.transform = `scaleX(${Math.min(1, Math.max(0, heatLevel))})`;
      }
    });

    return unsubscribe;
  }, []);

  return (
    <div className="chamfer-frame-md bg-[#00F0FF]/20">
      <div className="chamfer-inner p-4 font-data text-xs backdrop-blur-md">
        <div className="flex justify-between text-[#8B949E]">
          <span>HEAT LOAD INDEX</span>
          <span>热负荷指数</span>
        </div>
        <p ref={valueTextRef} className="mt-2 text-3xl font-bold text-[#00F0FF]">
          0.10
        </p>
        <div className="relative mt-3 h-2 w-full bg-[#161B22] overflow-hidden">
          <div
            ref={barFillRef}
            className="h-full w-full bg-gradient-to-r from-[#00F0FF] via-[#F59E0B] to-[#FF0055] origin-left transition-transform duration-75"
            style={{ transform: 'scaleX(0.10)' }}
          />
          <div className="absolute inset-y-0 left-[85%] w-0.5 bg-[#F59E0B]" title="0.85 警戒阈值" />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-[#8B949E]">
          <span>0.10 基线</span>
          <span className="text-[#F59E0B]">0.85 警戒</span>
          <span className="text-[#FF0055]">1.00 熔断</span>
        </div>
      </div>
    </div>
  );
};

/**
 * 热负荷数值告警配色：
 * - STAGE2_DECISION → 琥珀 #F59E0B (决断窗口期告警)
 * - AUTO_ABORT      → 品红 #FF0055 (熔断回弹)
 * - 其余阶段        → 青色 #00F0FF (主数据色)
 */
function getAlarmColor(currentPhase: FSMPhase): string {
  if (currentPhase === 'STAGE2_DECISION') return '#F59E0B';
  if (currentPhase === 'AUTO_ABORT') return '#FF0055';
  return '#00F0FF';
}
