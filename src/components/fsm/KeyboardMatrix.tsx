import React, { useEffect } from 'react';
import { FSMPhase } from '../../types/fsm';

interface KeyboardMatrixProps {
  phase: FSMPhase;
  onCommit: () => void;
  onAbort: () => void;
  onSelectPrevious?: () => void;
  onSelectNext?: () => void;
}

export const KeyboardMatrix: React.FC<KeyboardMatrixProps> = ({
  phase,
  onCommit,
  onAbort,
  onSelectPrevious,
  onSelectNext,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框中拦截
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      switch (e.key) {
        case 'Enter':
          if (phase === 'STAGE2_DECISION' || phase === 'STAGE1_SIMULATION') {
            e.preventDefault();
            onCommit();
          }
          break;
        case 'Escape':
          if (phase === 'STAGE1_SIMULATION' || phase === 'STAGE2_DECISION') {
            e.preventDefault();
            onAbort();
          }
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          if (phase === 'STABLE_IDLE') {
            e.preventDefault();
            onSelectPrevious?.();
          }
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          if (phase === 'STABLE_IDLE') {
            e.preventDefault();
            onSelectNext?.();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, onCommit, onAbort, onSelectPrevious, onSelectNext]);

  // 状态机语音/屏幕阅读器播报文本
  const getAnnouncementText = () => {
    switch (phase) {
      case 'STAGE1_SIMULATION':
        return '进入全息推演态，按ESC撤回';
      case 'STAGE2_DECISION':
        return '警告，进入十秒决断窗口，按ENTER确认锁定，按ESC放弃';
      case 'COMMITTED':
        return '定轨固化完成，结构已永久保存';
      case 'AUTO_ABORT':
        return '熔断协议启动，节点正在回弹原位';
      default:
        return '系统处于稳态待命';
    }
  };

  return (
    <div className="flex items-center gap-4 font-data text-xs text-[#8B949E]">
      {/* 隐藏的无障碍播报区 */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {getAnnouncementText()}
      </div>

      <span className="flex items-center gap-1.5">
        <kbd className="bg-[#161B22] border border-[#21262D] px-2 py-0.5 text-[#00F0FF] chamfer-sm">↑↓←→</kbd>
        <span>浏览</span>
      </span>
      <span className="flex items-center gap-1.5">
        <kbd className="bg-[#161B22] border border-[#21262D] px-2 py-0.5 text-[#00F0FF] chamfer-sm">ENTER</kbd>
        <span>固化</span>
      </span>
      <span className="flex items-center gap-1.5">
        <kbd className="bg-[#161B22] border border-[#21262D] px-2 py-0.5 text-[#FF0055] chamfer-sm">ESC</kbd>
        <span>撤回</span>
      </span>
    </div>
  );
};
