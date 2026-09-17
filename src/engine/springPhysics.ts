export interface SpringConfig {
  stiffness: number; // 劲度系数 k (默认 180)
  damping: number;   // 阻尼系数 c (默认 24)
  mass: number;      // 质量 m (默认 1.0)
  duration: number;  // 持续时间 1.2s
}

export const DEFAULT_SPRING_CONFIG: SpringConfig = {
  stiffness: 180,
  damping: 24,
  mass: 1.0,
  duration: 1.2,
};

export function computeSpringInterpolation(
  startPos: { x: number; y: number },
  targetPos: { x: number; y: number },
  elapsedTimeSec: number,
  config: SpringConfig = DEFAULT_SPRING_CONFIG
): { x: number; y: number; isFinished: boolean } {
  const { stiffness, damping, mass, duration } = config;
  const t = Math.min(elapsedTimeSec, duration);

  const omega0 = Math.sqrt(stiffness / mass);           // 无阻尼固有角频率
  const gamma = damping / (2 * mass);                   // 衰减系数
  const omegaD = Math.sqrt(Math.max(0, omega0 * omega0 - gamma * gamma)); // 阻尼角频率

  let factor = 1.0;
  if (omegaD > 0) {
    const envelope = Math.exp(-gamma * t);
    const oscillation = Math.cos(omegaD * t) + (gamma / omegaD) * Math.sin(omegaD * t);
    factor = 1.0 - envelope * oscillation;
  } else {
    factor = 1.0 - Math.exp(-gamma * t);
  }

  const isFinished = elapsedTimeSec >= duration;

  return {
    x: startPos.x + (targetPos.x - startPos.x) * factor,
    y: startPos.y + (targetPos.y - startPos.y) * factor,
    isFinished,
  };
}
