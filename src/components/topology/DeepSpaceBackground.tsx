import React from 'react';

/**
 * 深空背景层 (Layer 0)：
 * 1. 深渊底色：radial-gradient #06080B → #030508
 * 2. 径向细网格：repeating-radial-gradient 1px 同心圆环 (64px 步距)
 * 3. 固定光晕圆斑：3 处写死坐标的低透明度 radial-gradient 叠加
 * 4. SVG 同心轨道弧：stroke-opacity 0.06 静态轨道环 + 十字准线
 */
export const DeepSpaceBackground: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{
        backgroundImage: [
          // 四角渐晕：向深渊坠落
          'radial-gradient(ellipse at center, transparent 55%, rgba(3, 5, 8, 0.85) 100%)',
          // 光晕圆斑 1：左下冷青
          'radial-gradient(ellipse 420px 300px at 18% 76%, rgba(0, 240, 255, 0.05), transparent 70%)',
          // 光晕圆斑 2：右上冷青
          'radial-gradient(ellipse 560px 400px at 80% 20%, rgba(0, 240, 255, 0.04), transparent 70%)',
          // 光晕圆斑 3：右下琥珀微光
          'radial-gradient(ellipse 360px 360px at 64% 88%, rgba(245, 158, 11, 0.035), transparent 72%)',
          // 径向细网格：以视口中心发散的 1px 同心圆环
          'repeating-radial-gradient(circle at 50% 50%, rgba(139, 148, 158, 0.07) 0 1px, transparent 1px 64px)',
          // 深渊底色
          'radial-gradient(ellipse at 50% 42%, #06080B 0%, #030508 70%)',
        ].join(', '),
      }}
    >
      {/* 静态 SVG 轨道环 (无 JS、无动画，仅一次性绘制) */}
      <svg
        className="absolute left-1/2 top-1/2 h-[140vmin] w-[140vmin] -translate-x-1/2 -translate-y-1/2"
        viewBox="0 0 1000 1000"
        fill="none"
      >
        {/* 主轨道环 (实线) */}
        <g stroke="#00F0FF" strokeOpacity="0.06">
          <circle cx="500" cy="500" r="140" />
          <circle cx="500" cy="500" r="260" />
          <circle cx="500" cy="500" r="380" />
          <circle cx="500" cy="500" r="500" />
        </g>
        {/* 辅轨道环 (刻度虚线) */}
        <g stroke="#00F0FF" strokeOpacity="0.05" strokeDasharray="2 14">
          <circle cx="500" cy="500" r="200" />
          <circle cx="500" cy="500" r="320" />
          <circle cx="500" cy="500" r="440" />
        </g>
        {/* 十字准线 */}
        <g stroke="#00F0FF" strokeOpacity="0.04">
          <line x1="500" y1="0" x2="500" y2="1000" />
          <line x1="0" y1="500" x2="1000" y2="500" />
        </g>
      </svg>
    </div>
  );
};
