import { MutableRefObject, useEffect } from 'react';

/**
 * Canvas 高分屏自适应 Hook (支持传入外部 ref，被 TelemetryScope 与 TopologyCanvas 共用)
 *
 * 职责：
 * 1. 物理像素尺寸 = CSS 尺寸 × DPR (封顶 2x，3x/4x 设备避免 GPU 填充率过载)
 * 2. 重置变换矩阵后再叠加 scale(dpr, dpr)，绘制逻辑坐标系恒以 CSS 像素为单位
 * 3. ResizeObserver 监听画布尺寸变化，窗口拖拽/布局重排时自动重标定
 *
 * 防御性设计：
 * - rect 宽高为 0 (挂载瞬间布局未完成) 时跳过本轮，等待 ResizeObserver 下一次回调
 * - 先 setTransform(1,0,0,1,0,0) 重置，再 scale(dpr, dpr)，杜绝多次 resize 后变换堆叠
 */
export function useCanvasDPR(canvasRef: MutableRefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();

      // 零尺寸守卫：布局未完成时直接跳过，防止 0 尺寸画布与无效变换
      if (rect.width === 0 || rect.height === 0) return;

      // 1. DPR 封顶 2x
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      // 2. 物理像素缓冲区 = CSS 尺寸 × DPR
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      // 3. CSS 尺寸显式回写，防止画布撑破外层布局
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      // 4. 先重置变换矩阵，再叠加 DPR 缩放 (顺序不可颠倒，避免变换堆叠)
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    // 立即执行一次初始标定
    resizeCanvas();

    // 监听后续尺寸变化 (窗口拖拽、布局重排)
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
    };
  }, [canvasRef]);
}
