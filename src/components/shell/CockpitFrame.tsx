import React from 'react';

/**
 * CockpitFrame · 驾驶舱金属装甲装饰层
 *
 * 结构说明：
 * - 装饰层整体 pointer-events-none，绝不拦截拓扑画布的指针拖拽交互
 * - 外缘一圈 6px 铆钉（rivet）形成机械咬合质感
 * - 顶/底各一条 hazard-stripe 防滑斜纹警示带（左右各留 64px 给角标让位）
 * - 四角 45° 直角护角线与内部一圈极淡 P20 网格，构成驾驶舱舱壁视差
 *
 * 用法：<CockpitFrame><AppShell /></CockpitFrame>
 */

export interface CockpitFrameProps {
  children: React.ReactNode;
}

const RIVET_ROW = [0, 1, 2, 3];

export const CockpitFrame: React.FC<CockpitFrameProps> = ({ children }) => {
  return (
    <div className="relative h-full w-full">
      {/* ===== 装饰层 (Layer 1，位于内容之下且不拦截指针) ===== */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {/* 顶部/底部 铆钉排 */}
        <div className="absolute inset-x-3 top-2 flex items-center justify-between">
          {RIVET_ROW.map((i) => (
            <span key={`rivet-top-${i}`} className="rivet" />
          ))}
        </div>
        <div className="absolute inset-x-3 bottom-2 flex items-center justify-between">
          {RIVET_ROW.map((i) => (
            <span key={`rivet-bottom-${i}`} className="rivet" />
          ))}
        </div>

        {/* 左侧/右侧 铆钉列 */}
        <div className="absolute inset-y-3 left-2 flex flex-col items-center justify-between">
          {RIVET_ROW.map((i) => (
            <span key={`rivet-left-${i}`} className="rivet" />
          ))}
        </div>
        <div className="absolute inset-y-3 right-2 flex flex-col items-center justify-between">
          {RIVET_ROW.map((i) => (
            <span key={`rivet-right-${i}`} className="rivet" />
          ))}
        </div>

        {/* 上下防滑斜纹警示带 (左右各留 64px 让位给护角标) */}
        <div className="hazard-stripe absolute left-16 right-16 top-0 h-[3px] opacity-60" />
        <div className="hazard-stripe absolute bottom-0 left-16 right-16 h-[3px] opacity-60" />

        {/* 四角 45° 直角护角标 */}
        <div className="absolute left-1 top-1 h-14 w-14 border-l-2 border-t-2 border-[#00F0FF]/35" />
        <div className="absolute right-1 top-1 h-14 w-14 border-r-2 border-t-2 border-[#00F0FF]/35" />
        <div className="absolute bottom-1 left-1 h-14 w-14 border-b-2 border-l-2 border-[#00F0FF]/35" />
        <div className="absolute bottom-1 right-1 h-14 w-14 border-b-2 border-r-2 border-[#00F0FF]/35" />

        {/* 舱内 P20 极淡网格 (纯 CSS 渐变，零 Canvas、零重绘) */}
        <div
          className="absolute inset-x-8 inset-y-8"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--grid-hairline) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-hairline) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
      </div>

      {/* ===== 内容层 (Layer 2) ===== */}
      <div className="relative z-10 h-full w-full">{children}</div>
    </div>
  );
};
