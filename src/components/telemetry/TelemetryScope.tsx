import React, { useEffect, useRef } from 'react';
import { FSMPhase } from '../../types/fsm';
import { MatrixEngine } from '../../engine/MatrixEngine';
import { useCanvasDPR } from '../../hooks/useCanvasDPR';

export const TelemetryScope: React.FC<{ phase: FSMPhase }> = ({ phase }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useCanvasDPR(canvasRef);

  // 告警配色随决策阶段流转 (STAGE2 琥珀 / AUTO_ABORT 品红 / 其余青色)，
  // 经 Ref 透传进高频订阅回调，避免因 phase 变化反复重建订阅
  const phaseRef = useRef<FSMPhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const unsubscribe = MatrixEngine.getInstance().subscribe(({ heatLevel, timeSec, qosTier }) => {
      const width = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
      const height = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));

      // 1. 半透明黑色余辉清除
      ctx.fillStyle = 'rgba(6, 8, 11, 0.25)';
      ctx.fillRect(0, 0, width, height);

      // 2. 网格
      ctx.strokeStyle = 'rgba(139, 148, 158, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = 0; y < height; y += 20) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();

      // 3. 绘制速度轨 (CH-01 Cyan，决断期转琥珀告警，熔断期转品红)
      const currentPhase = phaseRef.current;
      const speedTrackColor =
        currentPhase === 'STAGE2_DECISION' ? '#F59E0B'
        : currentPhase === 'AUTO_ABORT' ? '#FF0055'
        : '#00F0FF';

      ctx.save();
      ctx.beginPath();
      if (qosTier === 'TIER_1_QUALITY') {
        ctx.shadowColor = speedTrackColor;
        ctx.shadowBlur = 8;
      }
      ctx.strokeStyle = speedTrackColor;
      ctx.lineWidth = 1.8;

      const points = 300;
      const step = width / points;
      const lambda = (heatLevel - 0.10) / 0.90; // 插值系数 0 -> 1

      for (let i = 0; i <= points; i++) {
        const x = i * step;
        // 稳态基波 + 动态高频突变波形
        const baseSin = Math.sin((i * 0.05) + (timeSec * 4));
        const shockSin = Math.sin((i * 0.25) + (timeSec * 16)) * Math.cos(timeSec * 8);
        const blended = (1 - lambda) * baseSin + lambda * (baseSin * 0.4 + shockSin * 0.8);
        const y = (height * 0.4) + blended * 24;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // 4. 绘制功率轨 (CH-02 Amber)
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.2;
      for (let i = 0; i <= points; i++) {
        const x = i * step;
        const wave = Math.cos((i * 0.04) + (timeSec * 3)) * (1 + lambda * 0.8);
        const y = (height * 0.72) + wave * 16;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    });

    return unsubscribe;
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full" />;
};
