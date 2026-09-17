import { QoSTier } from '../types/domain';
import { FSMPhase } from '../types/fsm';

export type HighFrequencyCallback = (data: {
  heatLevel: number;
  timeSec: number;
  qosTier: QoSTier;
  fps: number;
  phase: FSMPhase;
}) => void;

export class MatrixEngine {
  private static instance: MatrixEngine;
  private rafId: number | null = null;
  private listeners: Set<HighFrequencyCallback> = new Set();

  // 高频状态 (60Hz 独立更新)
  public heatLevel: number = 0.10;
  public qosTier: QoSTier = 'TIER_1_QUALITY';
  public fps: number = 60;
  public currentPhase: FSMPhase = 'STABLE_IDLE';

  // 零 GC 环形缓冲区计算 FPS (固定 60 槽位 Float64Array)
  private frameTimesBuffer = new Float64Array(60);
  private ringIndex: number = 0;
  private ringCount: number = 0;
  private lastTime: number = performance.now();

  // QoS 滞回计时器
  private lowFpsDuration: number = 0;
  private highFpsDuration: number = 0;

  private constructor() {
    this.startLoop();
  }

  public static getInstance(): MatrixEngine {
    if (!MatrixEngine.instance) {
      MatrixEngine.instance = new MatrixEngine();
    }
    return MatrixEngine.instance;
  }

  public setPhase(phase: FSMPhase) {
    this.currentPhase = phase;
  }

  public subscribe(fn: HighFrequencyCallback): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private startLoop = () => {
    const loop = (now: number) => {
      const delta = (now - this.lastTime) / 1000;
      this.lastTime = now;

      // 1. 零 GC 计算 FPS
      this.calculateFPS(delta);

      // 2. 动态驱动热负荷指数 (阶段一爬升至 0.85，阶段二爬升至 1.00，其余冷却至 0.10)
      this.updateHeatLevel(delta);

      // 3. 广播给所有高频直连组件 (Canvas, Scope, HeatMeter)
      const timeSec = now / 1000;
      this.listeners.forEach((listener) => {
        listener({
          heatLevel: this.heatLevel,
          timeSec,
          qosTier: this.qosTier,
          fps: this.fps,
          phase: this.currentPhase,
        });
      });

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  };

  private calculateFPS(delta: number) {
    if (delta <= 0) return;
    const currentFps = 1 / delta;
    this.frameTimesBuffer[this.ringIndex] = currentFps;
    this.ringIndex = (this.ringIndex + 1) % 60;
    if (this.ringCount < 60) this.ringCount++;

    let sum = 0;
    for (let i = 0; i < this.ringCount; i++) {
      sum += this.frameTimesBuffer[i];
    }
    const avgFps = sum / this.ringCount;
    this.fps = avgFps;

    // QoS 滞回：FPS < 45 持续 1s 降档；FPS >= 58 持续 3s 升档
    if (avgFps < 45) {
      this.lowFpsDuration += delta;
      this.highFpsDuration = 0;
      if (this.lowFpsDuration > 1.0) {
        this.degradeQoS();
        this.lowFpsDuration = 0;
      }
    } else if (avgFps >= 58) {
      this.highFpsDuration += delta;
      this.lowFpsDuration = 0;
      if (this.highFpsDuration > 3.0) {
        this.upgradeQoS();
        this.highFpsDuration = 0;
      }
    }
  }

  private updateHeatLevel(delta: number) {
    switch (this.currentPhase) {
      case 'STAGE1_SIMULATION':
        // 20s 内从 0.10 爬升至 0.85
        this.heatLevel = Math.min(0.85, this.heatLevel + (0.75 / 20) * delta);
        break;
      case 'STAGE2_DECISION':
        // 指数平滑趋近 1.00，无论从何值进入均在数秒内趋近熔断阈值
        this.heatLevel += (1.00 - this.heatLevel) * 0.4 * delta;
        if (this.heatLevel > 0.99) this.heatLevel = 1.00;
        break;
      case 'COMMITTED':
      case 'AUTO_ABORT':
      case 'STABLE_IDLE':
      default:
        // 平滑指数衰减冷却回基线 0.10
        if (this.heatLevel > 0.10) {
          this.heatLevel = Math.max(0.10, this.heatLevel - 0.45 * delta);
        }
        break;
    }
  }

  private degradeQoS() {
    if (this.qosTier === 'TIER_1_QUALITY') this.qosTier = 'TIER_2_BALANCED';
    else if (this.qosTier === 'TIER_2_BALANCED') this.qosTier = 'TIER_3_PERFORMANCE';
  }

  private upgradeQoS() {
    if (this.qosTier === 'TIER_3_PERFORMANCE') this.qosTier = 'TIER_2_BALANCED';
    else if (this.qosTier === 'TIER_2_BALANCED') this.qosTier = 'TIER_1_QUALITY';
  }

  public destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.listeners.clear();
  }
}
