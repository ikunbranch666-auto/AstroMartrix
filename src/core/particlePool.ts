/* ==========================================================================================
 * AstroMatrix · 零 GC 粒子对象池
 * 严格实现施工文档 v1.3 §5（粒子对象池模块）
 *
 * 设计要点：
 *   1. 固定容量 512 颗，预分配 Float32Array(512 * 6)，运行期零分配
 *   2. 内部布局：[x, y, vx, vy, life, maxLife]；type 独立存于 Uint8Array(512)
 *      —— 选独立 Uint8Array 而非第 7 个 float 字段：type 是 0..4 小整数，用 1 字节存储
 *         比 4 字节浮点更省内存，且便于后续按 type 做分支裁剪
 *   3. 环形指针：head = (head + 1) & 511（容量为 2 的幂，位运算取模）
 *   4. 渲染数据格式与内部存储格式解耦：getRenderData 输出紧凑 4 字段
 *      [x, y, alpha, type, ...]，alpha 由 life / maxLife 在导出时派生（不逐帧存）
 *   5. 无外部依赖，纯数值计算
 * ========================================================================================== */

export type ParticleType = 0 | 1 | 2 | 3 | 4; // 0:cyan, 1:amber, 2:magenta, 3:glow, 4:debris

export interface ParticlePool {
  spawn(x: number, y: number, vx: number, vy: number, maxLife: number, type: ParticleType): void;
  update(dt: number): void;
  getRenderData(): { count: number; data: Float32Array };
  clear(): void;
}

/* ================================ 内部常量（不导出） ================================ */

/** 池容量：必须为 2 的幂，方可使用位运算环形取模 */
const CAPACITY = 512;

/** 容量掩码：head = (head + 1) & SLOT_MASK */
const SLOT_MASK = CAPACITY - 1;

/** 单颗粒子的内部字段数：[x, y, vx, vy, life, maxLife] */
const FIELDS = 6;

/** 单颗粒子的渲染字段数：[x, y, alpha, type] */
const RENDER_FIELDS = 4;

/** 速度阻尼系数（v1.8 §11.3 粒子阻尼） */
const DAMPING = 0.95;

/** 35° 俯视透视 Y 轴压缩比（与全工程保持一致，作用于 y 方向位移） */
const PERSPECTIVE_K = 0.82;

/** 速度上限：防止数值爆炸（阻尼本身收敛，此处仅作安全护栏） */
const MAX_SPEED = 1e4;

/** 数值护栏：把非有限输入（NaN / Infinity）归零 */
const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

/* ================================ 粒子池实现（不导出类，仅导出工厂） ================================ */

class ParticlePoolImpl implements ParticlePool {
  /** 内部存储：[x, y, vx, vy, life, maxLife] × 512 */
  private readonly buffer: Float32Array;
  /** 粒子类型：0..4，独立 1 字节存储 */
  private readonly types: Uint8Array;
  /** 渲染紧凑缓冲区：[x, y, alpha, type] × 512 */
  private readonly renderBuffer: Float32Array;
  /** 环形写指针：初始 -1，首次 spawn 后指向槽位 0 */
  private head = -1;
  /** 当前存活粒子数（life > 0） */
  private aliveCount = 0;
  /** 是否发生过环绕写：用于区分"槽位从未 spawn"与"槽位已死亡" */
  private hasWrapped = false;

  constructor() {
    this.buffer = new Float32Array(CAPACITY * FIELDS);
    this.types = new Uint8Array(CAPACITY);
    this.renderBuffer = new Float32Array(CAPACITY * RENDER_FIELDS);
  }

  /**
   * 发射一颗粒子：直接写入环形槽位，不创建任何对象
   * 槽位被复用覆盖时，若原槽位粒子仍存活则同步修正 aliveCount
   */
  spawn(x: number, y: number, vx: number, vy: number, maxLife: number, type: ParticleType): void {
    // 1. 环形推进（位运算取模，容量为 2 的幂）
    this.head = (this.head + 1) & SLOT_MASK;
    if (this.head === 0 && !this.hasWrapped) this.hasWrapped = true;

    const base = this.head * FIELDS;

    // 2. 覆盖计数修正：槽位原粒子仍存活时，本次覆盖等价于"杀死"它
    if (this.buffer[base + 4] > 0) this.aliveCount--;

    // 3. 就地写入六字段（全部经过数值护栏）
    this.buffer[base] = finite(x);
    this.buffer[base + 1] = finite(y);
    this.buffer[base + 2] = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, finite(vx)));
    this.buffer[base + 3] = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, finite(vy)));

    // maxLife 至少保留一个极小正值，避免 alpha 派生时除零
    const life = Math.max(0, finite(maxLife));
    this.buffer[base + 5] = life > 0 ? life : 1e-6;
    this.buffer[base + 4] = this.buffer[base + 5];

    // 4. type 写入独立数组
    this.types[this.head] = type & 0xff;

    this.aliveCount++;
    if (this.aliveCount < 0) this.aliveCount = 0;
  }

  /**
   * 就地推进全部粒子：阻尼衰减 + 透视压缩积分 + 生命倒计时
   * 单趟线性遍历，不创建任何中间数组
   */
  update(dt: number): void {
    // 非正时间步直接跳过（暂停 / 首帧校准），避免 alpha 跳变与无意义遍历
    if (!(dt > 0)) return;
    // 时间步护栏：单帧最大 100ms，防止切换标签页回来后积分数值爆炸
    const step = Math.min(dt, 0.1);

    const buf = this.buffer;
    for (let i = 0; i < CAPACITY; i++) {
      const base = i * FIELDS;

      // 死亡槽位：跳过（life 恒为 0，不再重复递减）
      if (buf[base + 4] <= 0) continue;

      // 1. 速度阻尼
      const vx = buf[base + 2] * DAMPING;
      const vy = buf[base + 3] * DAMPING;

      // 2. 位置积分：x 轴按真实速度，y 轴额外叠加 35° 俯视透视压缩
      buf[base] += vx * step;
      buf[base + 1] += vy * PERSPECTIVE_K * step;

      // 3. 速度回写（已含阻尼）
      buf[base + 2] = vx;
      buf[base + 3] = vy;

      // 4. 生命倒计时
      const life = buf[base + 4] - step;
      if (life > 0) {
        buf[base + 4] = life;
      } else {
        // 寿终：置零并扣减存活计数
        buf[base + 4] = 0;
        this.aliveCount--;
      }
    }

    if (this.aliveCount < 0) this.aliveCount = 0;
  }

  /**
   * 导出渲染数据：把存活粒子就地压缩进 renderBuffer 的紧凑 4 字段布局
   * 返回 { count, data }，data 为 renderBuffer 的 subarray 视图（不复制）
   */
  getRenderData(): { count: number; data: Float32Array } {
    const buf = this.buffer;
    const out = this.renderBuffer;
    let n = 0;
    let alive = 0;

    // 环形未绕回（从未覆盖过旧槽位）时，已写入槽位必落在 [0, head] 区间内，
    // 据此收紧扫描上界，避免池刚启动就空转遍历全部 512 槽
    const safeScanLength = this.hasWrapped ? CAPACITY : this.head + 1;

    for (let i = 0; i < safeScanLength; i++) {
      const base = i * FIELDS;
      const life = buf[base + 4];
      if (life <= 0) continue;

      const maxLife = buf[base + 5];

      // alpha 由 life / maxLife 派生（此处才算，内部不逐帧存储）
      let alpha = maxLife > 0 ? life / maxLife : 0;
      if (alpha > 1) alpha = 1;
      else if (alpha < 0) alpha = 0;

      // 紧凑写入 [x, y, alpha, type]
      const o = n * RENDER_FIELDS;
      out[o] = buf[base];
      out[o + 1] = buf[base + 1];
      out[o + 2] = alpha;
      out[o + 3] = this.types[i];

      n++;
      alive++;
    }

    // 以实际遍历结果校准存活计数（防御性：与增量维护出现偏差时自愈）
    this.aliveCount = alive;

    // subarray 视图：零拷贝，仅创建一个轻量视图对象
    return { count: n, data: out.subarray(0, n * RENDER_FIELDS) };
  }

  /** 清空池：缓冲区归零，指针与计数复位 */
  clear(): void {
    this.buffer.fill(0);
    this.types.fill(0);
    this.renderBuffer.fill(0);
    this.head = -1;
    this.aliveCount = 0;
    this.hasWrapped = false;
  }
}

/**
 * 创建 512 颗固定容量的零 GC 粒子池
 */
export function createParticlePool(): ParticlePool {
  return new ParticlePoolImpl();
}
