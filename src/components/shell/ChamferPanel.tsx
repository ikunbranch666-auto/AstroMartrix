import React from 'react';

/**
 * ChamferPanel · 通用 45° 切角战术面板容器
 *
 * 采用「双重 clip-path 复合切角」方案实现真实 1px 倒角边框：
 * - 外层 div：加载 .chamfer-frame-{size}，其背景色即最终可见的 1px 边框亮线
 * - 内层 div：加载 .chamfer-inner，向内 inset 1px 后填充面板底色
 * 切角尺寸与边框描线色由 index.css 中的 .chamfer-frame-* / .chamfer-inner 统一约束，
 * 边框色刻意使用内联样式（--line-dim），以保证调用方传入的 Tailwind 背景类不会覆盖描线。
 */

export type ChamferSize = 'sm' | 'md' | 'lg';

export interface ChamferPanelProps {
  children: React.ReactNode;
  chamferSize?: ChamferSize;
  className?: string;
}

const FRAME_CLASS: Record<ChamferSize, string> = {
  sm: 'chamfer-frame-sm',
  md: 'chamfer-frame-md',
  lg: 'chamfer-frame-lg',
};

export const ChamferPanel: React.FC<ChamferPanelProps> = ({
  children,
  chamferSize = 'md',
  className = '',
}) => {
  return (
    <div
      className={`${FRAME_CLASS[chamferSize]} ${className}`}
      style={{ background: 'var(--line-dim)' }}
    >
      <div className="chamfer-inner">{children}</div>
    </div>
  );
};
