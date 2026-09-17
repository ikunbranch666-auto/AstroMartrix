# AstroMatrix · 施工工程技术规格书 (IMPLEMENTATION_SPEC)
**版本号**：v3.3-Production-Master (TopologyCanvas 坐标系统一与订阅稳定版)  
**更新日期**：2026-09-17  
**适用对象**：下游开发智能体 / 前端工程实现团队

---

## 目录
1. [工程配置文件全集 (P0 补齐)](#1-工程配置文件全集-p0-补齐)
   - 1.1 package.json (精简去冗余)
   - 1.2 vite.config.ts
   - 1.3 tsconfig.json
   - 1.4 tsconfig.node.json (补齐)
   - 1.5 tailwind.config.js (补齐 Token 映射)
   - 1.6 postcss.config.js (补齐)
   - 1.7 完整工程目录结构
   - 1.8 index.html (HTML 宿主模板)
   - 1.9 main.tsx (React 18 挂载入口)
2. [设计系统与可靠切角规范 (index.css)](#2-设计系统与可靠切角规范-indexcss)
   - 2.1 字体栈与真实 WebFont 载入
   - 2.2 真实 1px 45° 倒角边框方案 (SVG/Border-Box 避坑实现)
   - 2.3 面包屑防溢出保护
3. [核心数据模型与类型定义](#3-核心数据模型与类型定义)
   - 3.1 领域类型定义 (domain.ts)
   - 3.2 彻底解耦的状态机类型定义 (fsm.ts - 移除 heatLevel)
4. [双轨分流总线引擎与零 GC 采样实现](#4-双轨分流总线引擎与零-gc-采样实现)
   - 4.1 MatrixEngine (RAF 循环、高频热负荷驱动、Float64Array 环形缓冲、QoS 滞回)
   - 4.2 真实物理弹簧阻尼回弹算法 (springPhysics.ts)
   - 4.3 高分屏自适应 Hook (useCanvasDPR.ts)
5. [两阶段 FSM 调度器与高精度计时引擎](#5-两阶段-fsm-调度器与高精度计时引擎)
   - 5.1 useDecisionEngine (高精度 performance.now() 计时 + AUTO_ABORT 1.2s 自动回弹闭环)
   - 5.2 MatrixProvider (State / Actions 双 Context 隔离)
   - 5.3 KeyboardMatrix.tsx 完整实现 (键盘矩阵 + aria-live 无障碍)
6. [UI 布局骨架与组件全集](#6-ui-布局骨架与组件全集-apptsx--topologycanvas--telemetryscope--heatindexmeter--interlockingbreadcrumb--decisionstatusbar--deepspacebackground)
   - 6.1 HeatIndexMeter.tsx (热负荷计量条 · 直连 MatrixEngine 零重渲染)
   - 6.2 TelemetryScope.tsx (双轨 CRT 余辉示波器)
   - 6.3 TopologyCanvas.tsx (空间拓扑主画布 · 拖拽/回弹/QoS)
   - 6.4 App.tsx (三面板布局骨架)
   - 6.5 InterlockingBreadcrumb.tsx (45° 梯形咬合面包屑)
   - 6.6 DecisionStatusBar.tsx (决策状态徽章与双阶段倒计时)
   - 6.7 DeepSpaceBackground.tsx (纯 CSS+SVG 深渊星网背景)
7. [修复版 60 节点 Mock 生成器 (防自环边 + RELAY-2247 锁定)](#7-修复版-60-节点-mock-生成器-防自环边--relay-2247-锁定)
8. [项目启动与运行指引 (README.md)](#8-项目启动与运行指引-readmemd)

---

## 1. 工程配置文件全集 (P0 补齐)

### 1.1 `package.json` (精简无用依赖)

```json
{
  "name": "astromatrix-console",
  "private": true,
  "version": "3.2.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.2.2",
    "vite": "^5.3.1"
  }
}
```

### 1.2 `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    open: true,
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
```

### 1.3 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler 模式 */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    /* 代码质量检查 */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    /* 路径别名 */
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 1.4 `tsconfig.node.json` (补齐)

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### 1.5 `tailwind.config.js` (补齐)

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: 'var(--bg-void)',
        surface: {
          base: 'var(--surface-base)',
          raised: 'var(--surface-raised)',
          overlay: 'var(--surface-overlay)',
        },
        accent: {
          cyan: 'var(--accent-cyan)',
          amber: 'var(--accent-amber)',
          magenta: 'var(--accent-magenta)',
        },
        tactical: {
          line: 'var(--line-dim)',
          glow: 'var(--line-glow)',
          grid: 'var(--grid-hairline)',
        },
        content: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        data: ['ui-monospace', '"SF Mono"', '"JetBrains Mono"', '"Cascadia Code"', 'Consolas', '"Noto Sans Mono CJK SC"', 'monospace'],
      },
      transitionTimingFunction: {
        'tactical-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'tactical-in': 'cubic-bezier(0.75, 0, 0.25, 1)',
        'snap': 'cubic-bezier(0.19, 1, 0.22, 1)',
      },
    },
  },
  plugins: [],
};
```

### 1.6 `postcss.config.js` (补齐)

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### 1.7 完整工程目录结构

```text
/workspace/app-eggfrkuw8tmp/
├── public/
│   └── favicon.svg                   # 45° 切角天线图标
├── src/
│   ├── components/
│   │   ├── shell/
│   │   │   ├── ChamferPanel.tsx      # 45°/135° 倒角战术面板容器 (双重 clip-path 方案)
│   │   │   ├── InterlockingBreadcrumb.tsx # 45° 梯形咬合空间面包屑 (带 min-w 保护)
│   │   │   └── CockpitFrame.tsx      # 驾驶舱金属装甲、铆钉与防滑斜纹
│   │   ├── topology/
│   │   │   ├── TopologyCanvas.tsx    # 空间拓扑主画布 (松手位移≥15%进入Stage2、双重缓冲、阻尼回弹)
│   │   │   ├── NodeOverlayCard.tsx   # 选中节点 hover/focus 浮动遥测卡
│   │   │   └── DeepSpaceBackground.tsx # 纯 CSS+SVG 深渊星网背景 (零 Canvas、零订阅、零重绘)
│   │   ├── telemetry/
│   │   │   ├── TelemetryScope.tsx    # 双轨 CRT 余辉示波器组件 (直接订阅 MatrixEngine 高频)
│   │   │   └── HeatIndexMeter.tsx    # 热负荷指数计量条 (直接订阅 MatrixEngine 高频，零 React 重渲染)
│   │   └── fsm/
│   │       ├── DecisionStatusBar.tsx # 顶部状态与 10s 倒计时指示器 (消费低频 phase)
│   │       └── KeyboardMatrix.tsx    # 全局键盘事件监听与 aria-live 播报器
│   ├── context/
│   │   └── MatrixContext.tsx        # MatrixStateContext 与 MatrixActionsContext 隔离
│   ├── engine/
│   │   ├── MatrixEngine.ts          # 单例 RAF 循环、零GC采样、QoS 滞回
│   │   └── springPhysics.ts         # 1.2s 阻尼物理弹簧计算引擎 (接入全参数解析解)
│   ├── hooks/
│   │   ├── useDecisionEngine.ts     # FSM 调度 Hook (performance.now 高精度计时 + 1.2s 自动回弹)
│   │   └── useCanvasDPR.ts          # Canvas 高分屏自适应 (支持传入外部 ref)
│   ├── mocks/
│   │   └── mockDataGenerator.ts     # 60 节点 (含 RELAY-2247)、142 条连线 (防自环边)
│   ├── types/
│   │   ├── domain.ts                # 业务实体定义 (节点、边、星系、QoS)
│   │   └── fsm.ts                   # 决策状态机、Action 与事件类型 (无 heatLevel)
│   ├── App.tsx                      # 根布局骨架 (网格三面板比例)
│   ├── main.tsx                     # 应用挂载入口
│   └── index.css                    # Design Tokens、WebFont 载入、45° 切角类
├── index.html                       # HTML 宿主模板
├── package.json                     # 依赖与脚本定义
├── postcss.config.js                # PostCSS 插件配置
├── tailwind.config.js               # Tailwind 主题与路径扩展
├── tsconfig.json                    # TypeScript 编译配置
├── tsconfig.node.json               # Node 编译配置
├── vite.config.ts                   # Vite 构建配置
└── README.md                        # 项目启动与说明文档
```

### 1.8 `index.html` (HTML 宿主模板)

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#06080B" />
    <meta name="description" content="AstroMatrix · 深空系外天体探索与空间中继指挥控制中枢" />
    <title>AstroMatrix</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 1.9 `src/main.tsx` (应用挂载入口)

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// React 18 createRoot 并发挂载
// StrictMode 开发期双挂载校验：MatrixEngine 订阅与 FSM 定时器均已保证幂等清理
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

---

## 2. 设计系统与可靠切角规范 (`src/index.css`)

### 2.1 字体栈与真实 WebFont 载入

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ===== 稳健系统字体栈与 45° 倒角战术美学 ===== */
body {
  background-color: var(--bg-void);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
  user-select: none;
}

.font-data {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Consolas, "Noto Sans Mono CJK SC", monospace;
  font-variant-numeric: tabular-nums slashed-zero;
}

/* ===== 单层 45° 多面体切角核心类 (补齐) ===== */
.chamfer-sm {
  clip-path: polygon(
    6px 0,
    calc(100% - 6px) 0,
    100% 6px,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    6px 100%,
    0 calc(100% - 6px),
    0 6px
  );
}

.chamfer-md {
  clip-path: polygon(
    12px 0,
    calc(100% - 12px) 0,
    100% 12px,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    12px 100%,
    0 calc(100% - 12px),
    0 12px
  );
}

.chamfer-lg {
  clip-path: polygon(
    20px 0,
    calc(100% - 20px) 0,
    100% 20px,
    100% calc(100% - 20px),
    calc(100% - 20px) 100%,
    20px 100%,
    0 calc(100% - 20px),
    0 20px
  );
}

/* ===== 真实 1px 45° 倒角边框方案 (Dual-Layer 复合切角) ===== */
/* 原理：外层切角容器背景为边框发光色，内层切角内容向内 inset 1px 并填充面板底色 */
.chamfer-frame-sm {
  clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px), 0 6px);
  background: var(--line-dim);
  padding: 1px;
}
.chamfer-frame-sm > .chamfer-inner {
  clip-path: polygon(5px 0, calc(100% - 5px) 0, 100% 5px, 100% calc(100% - 5px), calc(100% - 5px) 100%, 5px 100%, 0 calc(100% - 5px), 0 5px);
  background: var(--surface-base);
  height: 100%;
  width: 100%;
}

.chamfer-frame-md {
  clip-path: polygon(12px 0, calc(100% - 12px) 0, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 12px), 0 12px);
  background: var(--line-dim);
  padding: 1px;
}
.chamfer-frame-md > .chamfer-inner {
  clip-path: polygon(11px 0, calc(100% - 11px) 0, 100% 11px, 100% calc(100% - 11px), calc(100% - 11px) 100%, 11px 100%, 0 calc(100% - 11px), 0 11px);
  background: var(--surface-base);
  height: 100%;
  width: 100%;
}

/* ===== 面包屑 45° 咬合切角与防溢出保护 ===== */
.crumb-lead {
  clip-path: polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
  min-width: 100px;
  flex-shrink: 0;
}

.crumb-tooth {
  clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
  min-width: 120px;
  flex-shrink: 0;
  margin-left: -14px;
}

/* 机械装饰 */
.rivet {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: radial-gradient(circle at 35% 30%, #7A848E, #262C34 72%);
  box-shadow: inset 0 -1px 1px rgba(0, 0, 0, 0.65);
}

.hazard-stripe {
  background: repeating-linear-gradient(
    45deg,
    rgba(245, 158, 11, 0.55) 0 6px,
    rgba(9, 12, 16, 0.92) 6px 12px
  );
}
```

---

## 3. 核心数据模型与类型定义

### 3.1 领域类型定义 (`src/types/domain.ts`)

```typescript
export type NodeType = 'RELAY' | 'HUB' | 'PROBE' | 'SCANNER';
export type NodeStatus = 'ACTIVE' | 'IDLE' | 'STAGED_TARGET' | 'LOCKED';

export interface SpatialCoords {
  x: number; // 相对百分比 0-100 或 画布实际像素
  y: number;
}

export interface RelayNode {
  id: string;                  // 唯一标识，如 "RELAY-2247"
  name: string;                // 节点展示名
  type: NodeType;              // 节点类型
  status: NodeStatus;          // 状态
  galaxyId: string;            // 主星系
  sectorId: string;            // 所属扇区，如 "SECTOR-07"
  sectorName: string;          // 扇区中文名
  coords: SpatialCoords;       // 实时渲染坐标 (受推演与回弹驱动)
  baseCoords: SpatialCoords;   // 锚定基准坐标 (阻尼回弹目标)
  velocity: number;            // 轨道速度 (KM/S)
  latency: number;             // 链路延迟 (MS)
  signalPower: number;         // 信号强度 (DBM)
  payloadCapacity: number;     // 负载率 (0.0 - 1.0)
}

export interface NetworkEdge {
  id: string;
  sourceId: string;
  targetId: string;
  bandwidth: number;           // Gbps
  isVirtualSimulation?: boolean; // 是否为推演中虚线
}

export interface GalaxyHierarchy {
  galaxyId: string;
  galaxyName: string;
  sectors: {
    sectorId: string;
    sectorName: string;
    nodeIds: string[];
  }[];
}

export type QoSTier = 'TIER_1_QUALITY' | 'TIER_2_BALANCED' | 'TIER_3_PERFORMANCE';
```

### 3.2 彻底解耦的状态机类型定义 (`src/types/fsm.ts`)
*【架构修复】*：**彻底移除 `DecisionState.heatLevel`**，React 只管 <1Hz 的离散状态与目标坐标，高频热负荷完全由 `MatrixEngine` 单例通过发布订阅模式驱动。

```typescript
import { SpatialCoords } from './domain';

export type FSMPhase = 
  | 'STABLE_IDLE'          // 稳态待命
  | 'STAGE1_SIMULATION'    // 阶段一：全息推演态 (上限 20s)
  | 'STAGE2_DECISION'      // 阶段二：决策窗口期 (倒计时 10s)
  | 'COMMITTED'            // 终局：不可逆定轨固化
  | 'AUTO_ABORT';          // 终局：超时或主动熔断 (1.2s 阻尼回弹)

export interface DecisionState {
  phase: FSMPhase;
  selectedNodeId: string;            // 当前选中/聚焦节点 (默认 "RELAY-2247")
  targetCoords: SpatialCoords | null; // 推演目标坐标
  stage1TimeRemaining: number;       // 阶段一剩余秒数 (最大 20)
  stage2TimeRemaining: number;       // 阶段二倒计时 (最大 10)
  isSpringRebounding: boolean;       // 是否处于 1.2s 阻尼回弹动画中
}

export type FSMAction =
  | { type: 'SELECT_NODE'; payload: { nodeId: string } }
  | { type: 'START_SIMULATION'; payload: { nodeId: string; startCoords: SpatialCoords } }
  | { type: 'UPDATE_SIMULATION_COORDS'; payload: { coords: SpatialCoords } }
  | { type: 'ENTER_DECISION_STAGE' }
  | { type: 'COMMIT_DECISION' }
  | { type: 'TRIGGER_ABORT'; payload: { reason: 'TIMEOUT' | 'USER_CANCEL' } }
  | { type: 'COMPLETE_REBOUND' }
  | { type: 'RETURN_TO_IDLE' }
  | { type: 'TICK_TIME'; payload: { elapsedSeconds: number } };
```

---

## 4. 双轨分流总线引擎与零 GC 采样实现

### 4.1 MatrixEngine (`src/engine/MatrixEngine.ts`)

```typescript
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
```

### 4.2 真实物理弹簧阻尼回弹算法 (`src/engine/springPhysics.ts`)

```typescript
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
```

### 4.3 高分屏自适应 Hook (`src/hooks/useCanvasDPR.ts`)

```typescript
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
```

---

## 5. 两阶段 FSM 调度器与高精度计时引擎

### 5.1 `useDecisionEngine.ts` (高精度计时 + 自动熔断闭环)

```typescript
import { useReducer, useEffect, useCallback, useRef } from 'react';
import { DecisionState, FSMAction } from '../types/fsm';
import { MatrixEngine } from '../engine/MatrixEngine';

export const initialDecisionState: DecisionState = {
  phase: 'STABLE_IDLE',
  selectedNodeId: 'RELAY-2247',
  targetCoords: null,
  stage1TimeRemaining: 20,
  stage2TimeRemaining: 10,
  isSpringRebounding: false,
};

export function fsmReducer(state: DecisionState, action: FSMAction): DecisionState {
  switch (action.type) {
    case 'SELECT_NODE':
      if (state.phase !== 'STABLE_IDLE') return state;
      return { ...state, selectedNodeId: action.payload.nodeId };

    case 'START_SIMULATION':
      if (state.phase !== 'STABLE_IDLE') return state;
      return {
        ...state,
        phase: 'STAGE1_SIMULATION',
        selectedNodeId: action.payload.nodeId,
        targetCoords: action.payload.startCoords,
        stage1TimeRemaining: 20,
        stage2TimeRemaining: 10,
        isSpringRebounding: false,
      };

    case 'UPDATE_SIMULATION_COORDS':
      if (state.phase !== 'STAGE1_SIMULATION' && state.phase !== 'STAGE2_DECISION') return state;
      return { ...state, targetCoords: action.payload.coords };

    case 'ENTER_DECISION_STAGE':
      if (state.phase !== 'STAGE1_SIMULATION') return state;
      return {
        ...state,
        phase: 'STAGE2_DECISION',
        stage1TimeRemaining: 0,
        stage2TimeRemaining: 10,
      };

    case 'COMMIT_DECISION':
      if (state.phase !== 'STAGE2_DECISION' && state.phase !== 'STAGE1_SIMULATION') return state;
      return {
        ...state,
        phase: 'COMMITTED',
        isSpringRebounding: false,
      };

    case 'TRIGGER_ABORT':
      return {
        ...state,
        phase: 'AUTO_ABORT',
        isSpringRebounding: true,
      };

    case 'COMPLETE_REBOUND':
      return {
        ...state,
        phase: 'STABLE_IDLE',
        targetCoords: null,
        stage1TimeRemaining: 20,
        stage2TimeRemaining: 10,
        isSpringRebounding: false,
      };

    case 'RETURN_TO_IDLE':
      if (state.phase !== 'COMMITTED') return state;
      return {
        ...state,
        phase: 'STABLE_IDLE',
        targetCoords: null,
        stage1TimeRemaining: 20,
        stage2TimeRemaining: 10,
        isSpringRebounding: false,
      };

    case 'TICK_TIME': {
      const elapsed = action.payload.elapsedSeconds;
      if (state.phase === 'STAGE1_SIMULATION') {
        const remaining = Math.max(0, 20 - elapsed);
        if (remaining <= 0) {
          // 20s 推演期结束，自动进入 10s 决断期
          return {
            ...state,
            phase: 'STAGE2_DECISION',
            stage1TimeRemaining: 0,
            stage2TimeRemaining: 10,
          };
        }
        return { ...state, stage1TimeRemaining: remaining };
      }

      if (state.phase === 'STAGE2_DECISION') {
        const remaining = Math.max(0, 10 - elapsed);
        if (remaining <= 0) {
          // 10s 决断倒计时归零，触发自动熔断
          return {
            ...state,
            phase: 'AUTO_ABORT',
            stage2TimeRemaining: 0,
            isSpringRebounding: true,
          };
        }
        return { ...state, stage2TimeRemaining: remaining };
      }

      return state;
    }

    default:
      return state;
  }
}

export function useDecisionEngine() {
  const [state, dispatch] = useReducer(fsmReducer, initialDecisionState);
  const phaseStartTimeRef = useRef<number>(performance.now());

  // 同步 Phase 变迁至 MatrixEngine
  useEffect(() => {
    MatrixEngine.getInstance().setPhase(state.phase);
    phaseStartTimeRef.current = performance.now();
  }, [state.phase]);

  // AUTO_ABORT 1.2s 阻尼动画结束后自动派发 COMPLETE_REBOUND 闭环 (修复卡死 Bug)
  useEffect(() => {
    if (state.phase !== 'AUTO_ABORT') return;
    const timer = setTimeout(() => {
      dispatch({ type: 'COMPLETE_REBOUND' });
    }, 1200);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // COMMITTED 2s 展示结束后自动派发 RETURN_TO_IDLE 闭环 (修复固化后卡死 Bug)
  useEffect(() => {
    if (state.phase !== 'COMMITTED') return;
    const timer = setTimeout(() => {
      dispatch({ type: 'RETURN_TO_IDLE' });
    }, 2000);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // 高精度 performance.now() 计时器 (消除 setInterval 累积误差)
  useEffect(() => {
    if (state.phase !== 'STAGE1_SIMULATION' && state.phase !== 'STAGE2_DECISION') return;

    const interval = setInterval(() => {
      const elapsed = (performance.now() - phaseStartTimeRef.current) / 1000;
      dispatch({ type: 'TICK_TIME', payload: { elapsedSeconds: elapsed } });
    }, 50); // 20Hz 刷新 UI 倒计时数字足以，丝滑且无误差

    return () => clearInterval(interval);
  }, [state.phase]);

  const selectNode = useCallback((nodeId: string) => dispatch({ type: 'SELECT_NODE', payload: { nodeId } }), []);
  const startSimulation = useCallback((nodeId: string, coords: { x: number; y: number }) => {
    dispatch({ type: 'START_SIMULATION', payload: { nodeId, startCoords: coords } });
  }, []);
  const updateCoords = useCallback((coords: { x: number; y: number }) => {
    dispatch({ type: 'UPDATE_SIMULATION_COORDS', payload: { coords } });
  }, []);
  const enterDecisionStage = useCallback(() => dispatch({ type: 'ENTER_DECISION_STAGE' }), []);
  const commitDecision = useCallback(() => dispatch({ type: 'COMMIT_DECISION' }), []);
  const triggerAbort = useCallback((reason: 'TIMEOUT' | 'USER_CANCEL') => {
    dispatch({ type: 'TRIGGER_ABORT', payload: { reason } });
  }, []);
  const completeRebound = useCallback(() => dispatch({ type: 'COMPLETE_REBOUND' }), []);
  const returnToIdle = useCallback(() => dispatch({ type: 'RETURN_TO_IDLE' }), []);

  return {
    state,
    actions: {
      selectNode,
      startSimulation,
      updateCoords,
      enterDecisionStage,
      commitDecision,
      triggerAbort,
      completeRebound,
      returnToIdle,
    },
  };
}
```

### 5.2 `MatrixContext.tsx`

```typescript
import React, { createContext, useContext } from 'react';
import { DecisionState } from '../types/fsm';
import { useDecisionEngine } from '../hooks/useDecisionEngine';

export interface MatrixActions {
  selectNode: (nodeId: string) => void;
  startSimulation: (nodeId: string, coords: { x: number; y: number }) => void;
  updateCoords: (coords: { x: number; y: number }) => void;
  enterDecisionStage: () => void;
  commitDecision: () => void;
  triggerAbort: (reason: 'TIMEOUT' | 'USER_CANCEL') => void;
  completeRebound: () => void;
  returnToIdle: () => void;
}

const MatrixStateContext = createContext<DecisionState | null>(null);
const MatrixActionsContext = createContext<MatrixActions | null>(null);

export const MatrixProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, actions } = useDecisionEngine();

  return (
    <MatrixStateContext.Provider value={state}>
      <MatrixActionsContext.Provider value={actions}>
        {children}
      </MatrixActionsContext.Provider>
    </MatrixStateContext.Provider>
  );
};

export function useMatrixState(): DecisionState {
  const ctx = useContext(MatrixStateContext);
  if (!ctx) throw new Error('useMatrixState must be used within MatrixProvider');
  return ctx;
}

export function useMatrixActions(): MatrixActions {
  const ctx = useContext(MatrixActionsContext);
  if (!ctx) throw new Error('useMatrixActions must be used within MatrixProvider');
  return ctx;
}
```

### 5.3 `KeyboardMatrix.tsx` 完整实现 (补齐)

```tsx
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
```

---

## 6. UI 布局骨架与组件全集 (`App.tsx` / `TopologyCanvas` / `TelemetryScope` / `HeatIndexMeter` / `InterlockingBreadcrumb` / `DecisionStatusBar` / `DeepSpaceBackground`)

### 6.1 `HeatIndexMeter.tsx` (直接订阅 MatrixEngine，零 React 重渲染)

```tsx
import React, { useEffect, useRef } from 'react';
import { FSMPhase } from '../../types/fsm';
import { MatrixEngine } from '../../engine/MatrixEngine';

export const HeatIndexMeter: React.FC<{ phase: FSMPhase }> = ({ phase }) => {
  const valueTextRef = useRef<HTMLParagraphElement | null>(null);
  const barFillRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 高频 60Hz 订阅 MatrixEngine，直接操作 DOM
    // 采用 transform: scaleX() 代替 width%，只触发 Composite 不触发 Layout
    const unsubscribe = MatrixEngine.getInstance().subscribe(({ heatLevel }) => {
      if (valueTextRef.current) {
        valueTextRef.current.textContent = heatLevel.toFixed(2);
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
```

### 6.2 `TelemetryScope.tsx` (内部直连 MatrixEngine 高频波形)

```tsx
import React, { useEffect, useRef } from 'react';
import { FSMPhase } from '../../types/fsm';
import { MatrixEngine } from '../../engine/MatrixEngine';
import { useCanvasDPR } from '../../hooks/useCanvasDPR';

export const TelemetryScope: React.FC<{ phase: FSMPhase; velocity: number }> = ({
  phase,
  velocity,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useCanvasDPR(canvasRef);

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

      // 3. 绘制速度轨 (CH-01 Cyan)
      ctx.save();
      ctx.beginPath();
      if (qosTier === 'TIER_1_QUALITY') {
        ctx.shadowColor = '#00F0FF';
        ctx.shadowBlur = 8;
      }
      ctx.strokeStyle = '#00F0FF';
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
```

### 6.3 `TopologyCanvas.tsx` 完整实现 (松手位移 ≥ 15% 进入 Stage2)

```tsx
import React, { useEffect, useRef } from 'react';
import { RelayNode, NetworkEdge, SpatialCoords } from '../../types/domain';
import { FSMPhase } from '../../types/fsm';
import { MatrixEngine } from '../../engine/MatrixEngine';
import { useCanvasDPR } from '../../hooks/useCanvasDPR';
import { computeSpringInterpolation } from '../../engine/springPhysics';

interface TopologyCanvasProps {
  nodes: Record<string, RelayNode>;
  edges: NetworkEdge[];
  selectedNodeId: string;
  phase: FSMPhase;
  targetCoords: SpatialCoords | null;
  onSelectNode: (nodeId: string) => void;
  onStartSimulation: (nodeId: string, coords: SpatialCoords) => void;
  onUpdateCoords: (coords: SpatialCoords) => void;
  onEnterDecisionStage: () => void;
  onTriggerAbort: () => void;
  onCompleteRebound: () => void;
}

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  phase,
  targetCoords,
  onSelectNode,
  onStartSimulation,
  onUpdateCoords,
  onEnterDecisionStage,
  onTriggerAbort,
  onCompleteRebound,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useCanvasDPR(canvasRef);

  // Refs 缓存渲染所需数据 (高频 targetCoords 每帧变化，绝不能进渲染 effect 依赖)
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const targetCoordsRef = useRef(targetCoords);
  targetCoordsRef.current = targetCoords;
  const onCompleteReboundRef = useRef(onCompleteRebound);
  onCompleteReboundRef.current = onCompleteRebound;

  // 拖拽与指针状态
  const isPointerDownRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasMovedPastThresholdRef = useRef(false);
  const draggedNodeIdRef = useRef<string | null>(null);
  const currentDragPosRef = useRef<{ x: number; y: number } | null>(null);

  // 阻尼回弹状态
  const reboundStartTimeRef = useRef<number | null>(null);
  const reboundStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // 监听 AUTO_ABORT 记录回弹起点 (Bug1 修复：统一像素坐标系，杜绝百分比/像素混用)
  useEffect(() => {
    if (phase !== 'AUTO_ABORT') {
      reboundStartTimeRef.current = null;
      reboundStartPosRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    reboundStartTimeRef.current = performance.now();

    if (currentDragPosRef.current) {
      // 用户拖拽中的位置：已是像素坐标，直接使用
      reboundStartPosRef.current = currentDragPosRef.current;
    } else if (targetCoordsRef.current) {
      // 键盘操作/测试路径：从 targetCoords (百分比) 换算成像素
      reboundStartPosRef.current = {
        x: (targetCoordsRef.current.x / 100) * width,
        y: (targetCoordsRef.current.y / 100) * height,
      };
    } else {
      // 最终兜底：选中节点基准坐标 (百分比转像素)
      const activeNode = nodesRef.current[selectedNodeIdRef.current];
      reboundStartPosRef.current = activeNode
        ? {
            x: (activeNode.baseCoords.x / 100) * width,
            y: (activeNode.baseCoords.y / 100) * height,
          }
        : null;
    }
  }, [phase]); // 依赖只保留 phase：仅在状态变迁瞬间记录一次起点

  // 高频 Canvas 渲染循环 (直接订阅 MatrixEngine)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const unsubscribe = MatrixEngine.getInstance().subscribe(({ qosTier, timeSec }) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      // 1. 清屏 (透明，露出底层的极坐标星网)
      ctx.clearRect(0, 0, width, height);

      // 从 Refs 读取最新渲染数据 (Bug3 修复：订阅只建立一次，数据经 Ref 透传)
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const currentSelectedNodeId = selectedNodeIdRef.current;
      const currentPhase = phaseRef.current;
      const currentTargetCoords = targetCoordsRef.current;

      // 计算当前拖拽或回弹节点坐标
      let activePos: { x: number; y: number } | null = null;
      const activeNode = currentNodes[currentSelectedNodeId];

      if (currentPhase === 'AUTO_ABORT' && reboundStartTimeRef.current && reboundStartPosRef.current && activeNode) {
        const elapsed = (performance.now() - reboundStartTimeRef.current) / 1000;
        const targetPixel = {
          x: (activeNode.baseCoords.x / 100) * width,
          y: (activeNode.baseCoords.y / 100) * height,
        };
        const spring = computeSpringInterpolation(reboundStartPosRef.current, targetPixel, elapsed);
        activePos = { x: spring.x, y: spring.y };

        if (spring.isFinished) {
          reboundStartTimeRef.current = null;
          reboundStartPosRef.current = null;
          currentDragPosRef.current = null;
          onCompleteReboundRef.current();
        }
      } else if (currentTargetCoords) {
        activePos = {
          x: (currentTargetCoords.x / 100) * width,
          y: (currentTargetCoords.y / 100) * height,
        };
      }

      // 2. 绘制常规网络拓扑边 (Edges)
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
      ctx.lineWidth = 1;
      currentEdges.forEach((edge) => {
        const s = currentNodes[edge.sourceId];
        const t = currentNodes[edge.targetId];
        if (!s || !t) return;

        const sx = (s.id === currentSelectedNodeId && activePos) ? activePos.x : (s.coords.x / 100) * width;
        const sy = (s.id === currentSelectedNodeId && activePos) ? activePos.y : (s.coords.y / 100) * height;
        const tx = (t.id === currentSelectedNodeId && activePos) ? activePos.x : (t.coords.x / 100) * width;
        const ty = (t.id === currentSelectedNodeId && activePos) ? activePos.y : (t.coords.y / 100) * height;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      });
      ctx.restore();

      // 3. 绘制阶段一推演虚线 (STAGE1_SIMULATION 琥珀虚线：仅拖动轨迹，不画预测线)
      if (currentPhase === 'STAGE1_SIMULATION' && activePos && activeNode) {
        ctx.save();
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);

        // 连接基准原点与当前推演点
        const baseX = (activeNode.baseCoords.x / 100) * width;
        const baseY = (activeNode.baseCoords.y / 100) * height;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(activePos.x, activePos.y);
        ctx.stroke();

        ctx.restore();
      }

      // 4. 绘制所有节点 (Nodes)
      // 离屏预计算 LOCKED 节点集合，避免每帧创建中间数组 (零 GC 采样)
      const lockedIds = new Set<string>();
      Object.values(currentNodes).forEach((node) => {
        if (node.status === 'LOCKED') lockedIds.add(node.id);
      });

      Object.values(currentNodes).forEach((node) => {
        const isSelected = node.id === currentSelectedNodeId;
        const nx = (isSelected && activePos) ? activePos.x : (node.coords.x / 100) * width;
        const ny = (isSelected && activePos) ? activePos.y : (node.coords.y / 100) * height;

        ctx.save();
        if (isSelected) {
          // 选中节点光晕与锁定框 (LOCKED 优先绿 / STAGE2 琥珀 / ACTIVE 青 / 其余灰)
          const selectedColor = lockedIds.has(node.id)
            ? '#3FB950'
            : currentPhase === 'STAGE2_DECISION' ? '#F59E0B'
            : node.status === 'ACTIVE' ? '#00F0FF' : '#8B949E';
          if (qosTier === 'TIER_1_QUALITY') {
            ctx.shadowColor = selectedColor;
            ctx.shadowBlur = 12;
          }
          ctx.fillStyle = selectedColor;
          ctx.beginPath();
          ctx.arc(nx, ny, 7, 0, Math.PI * 2);
          ctx.fill();

          // 绘制直角瞄准标
          ctx.strokeStyle = selectedColor;
          ctx.lineWidth = 1.5;
          const s = 14;
          ctx.strokeRect(nx - s, ny - s, s * 2, s * 2);
        } else {
          // 常规节点三态配色：LOCKED 绿 / ACTIVE 青 / IDLE & STAGED_TARGET 灰
          ctx.fillStyle = lockedIds.has(node.id)
            ? '#3FB950'
            : node.status === 'ACTIVE' ? '#00F0FF' : '#8B949E';
          ctx.beginPath();
          ctx.arc(nx, ny, node.type === 'RELAY' ? 4.5 : 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    });

    return unsubscribe;
  }, []); // Bug3 修复：空依赖，MatrixEngine 订阅只建立一次，渲染数据全部经 Ref 透传

  // 指针交互处理 (5px 触发 Stage1, 15% 宽度触发 Stage2)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || phase === 'AUTO_ABORT' || phase === 'COMMITTED') return;

    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // 命中检测 (20px 半径，且仅 ACTIVE 节点可进入拖拽流程)
    let hitNode: RelayNode | null = null;
    for (const node of Object.values(nodes)) {
      if (node.status !== 'ACTIVE') continue;
      const nx = (node.coords.x / 100) * rect.width;
      const ny = (node.coords.y / 100) * rect.height;
      const dist = Math.hypot(px - nx, py - ny);
      if (dist <= 20) {
        hitNode = node;
        break;
      }
    }

    if (hitNode) {
      isPointerDownRef.current = true;
      dragStartRef.current = { x: px, y: py };
      hasMovedPastThresholdRef.current = false;
      draggedNodeIdRef.current = hitNode.id;
      currentDragPosRef.current = { x: px, y: py };
      onSelectNode(hitNode.id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDownRef.current || !dragStartRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    currentDragPosRef.current = { x: px, y: py };

    const dx = px - dragStartRef.current.x;
    const dy = py - dragStartRef.current.y;
    const moveDist = Math.hypot(dx, dy);

    // 超过 5px 立即进入 STAGE1_SIMULATION
    if (!hasMovedPastThresholdRef.current && moveDist > 5) {
      hasMovedPastThresholdRef.current = true;
      if (draggedNodeIdRef.current) {
        onStartSimulation(draggedNodeIdRef.current, {
          x: (px / rect.width) * 100,
          y: (py / rect.height) * 100,
        });
      }
    }

    if (hasMovedPastThresholdRef.current) {
      onUpdateCoords({
        x: (px / rect.width) * 100,
        y: (py / rect.height) * 100,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDownRef.current || !dragStartRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const moveDist = Math.hypot(px - dragStartRef.current.x, py - dragStartRef.current.y);
    const threshold = rect.width * 0.15; // 15% 画布宽度阈值

    if (hasMovedPastThresholdRef.current) {
      if (moveDist >= threshold) {
        // 位移充足直接进入 Stage2 决策窗口
        onEnterDecisionStage();
      } else {
        // Bug2 修复：位移不足触发熔断，走 AUTO_ABORT → 1.2s 阻尼回弹 → COMPLETE_REBOUND 完整链路
        // (直接派发 COMPLETE_REBOUND 会瞬间跳回 baseCoords，丢失回弹动画)
        onTriggerAbort();
      }
    }

    isPointerDownRef.current = false;
    dragStartRef.current = null;
    hasMovedPastThresholdRef.current = false;
    draggedNodeIdRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="h-full w-full cursor-crosshair touch-none"
    />
  );
};
```

### 6.4 `App.tsx` (重构后的纯净布局骨架)

```tsx
import React, { useEffect, useState } from 'react';
import { MatrixProvider, useMatrixState, useMatrixActions } from './context/MatrixContext';
import { generateMockGalaxyData } from './mocks/mockDataGenerator';
import { RelayNode } from './types/domain';

import { InterlockingBreadcrumb } from './components/shell/InterlockingBreadcrumb';
import { DecisionStatusBar } from './components/fsm/DecisionStatusBar';
import { TopologyCanvas } from './components/topology/TopologyCanvas';
import { DeepSpaceBackground } from './components/topology/DeepSpaceBackground';
import { TelemetryScope } from './components/telemetry/TelemetryScope';
import { HeatIndexMeter } from './components/telemetry/HeatIndexMeter';
import { KeyboardMatrix } from './components/fsm/KeyboardMatrix';

const AstroMatrixLayout: React.FC = () => {
  const state = useMatrixState();
  const actions = useMatrixActions();

  const [data, setData] = useState(() => generateMockGalaxyData());
  const selectedNode = data.nodes[state.selectedNodeId] || data.nodes['RELAY-2247'];

  // 固化完成 (COMMITTED)：1) 把被拖拽节点标记 LOCKED 并把推演终点固化为新的 coords / baseCoords，
  // 拓扑结构永久更新，RETURN_TO_IDLE 后节点停留在新位置；
  // 2) 规则 3：从 IDLE 中挑距离落点最近的节点升级为 ACTIVE，避免 ACTIVE 池被逐个固化消耗殆尽。
  useEffect(() => {
    if (state.phase !== 'COMMITTED') return;
    const nodeId = state.selectedNodeId;
    const target = state.targetCoords;
    if (!target) return;
    setData(prev => {
      const node = prev.nodes[nodeId];
      if (!node) return prev;

      // 1. 固化当前节点
      const lockedNode = {
        ...node,
        status: 'LOCKED' as const,
        coords: { x: target.x, y: target.y },
        baseCoords: { x: target.x, y: target.y },
      };

      // 2. 从 IDLE 里挑一个升级为 ACTIVE（最近的）
      const idleCandidates = Object.values(prev.nodes).filter(
        n => n.id !== nodeId && n.status === 'IDLE'
      );
      let replacement = null;
      if (idleCandidates.length > 0) {
        replacement = idleCandidates.reduce((a, b) => {
          const da = Math.hypot(a.coords.x - target.x, a.coords.y - target.y);
          const db = Math.hypot(b.coords.x - target.x, b.coords.y - target.y);
          return da < db ? a : b;
        });
      }

      const nextNodes: Record<string, RelayNode> = {
        ...prev.nodes,
        [nodeId]: lockedNode,
      };
      if (replacement) {
        nextNodes[replacement.id] = { ...replacement, status: 'ACTIVE' as const };
      }

      return { ...prev, nodes: nextNodes };
    });
  }, [state.phase, state.selectedNodeId, state.targetCoords]);

  // 焦点重定向：稳态下若当前选中节点不是 ACTIVE (已被固化锁定)，则改选最近的 ACTIVE 节点，
  // 否则控制台会卡在"选中节点被锁、又无法选中别的节点"的死局。
  // 不会死循环：重定向后 selectedNodeId 指向 ACTIVE 节点，下一次触发即由首个 return 提前退出。
  useEffect(() => {
    if (state.phase !== 'STABLE_IDLE') return;
    const current = data.nodes[state.selectedNodeId];
    if (current && current.status === 'ACTIVE') return;
    const candidates = Object.values(data.nodes).filter(n => n.status === 'ACTIVE');
    if (candidates.length === 0) return;
    const anchor = data.nodes[state.selectedNodeId];
    const nearest = anchor
      ? candidates.reduce((a, b) => {
          const da = Math.hypot(a.coords.x - anchor.coords.x, a.coords.y - anchor.coords.y);
          const db = Math.hypot(b.coords.x - anchor.coords.x, b.coords.y - anchor.coords.y);
          return da < db ? a : b;
        })
      : candidates[0];
    if (nearest.id !== state.selectedNodeId) {
      actions.selectNode(nearest.id);
    }
  }, [state.phase, data.nodes, state.selectedNodeId, actions]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#06080B] text-[#F0F6FC] font-sans flex flex-col">
      {/* 极坐标背景 Canvas 层 (Layer 0) */}
      <DeepSpaceBackground />

      {/* 顶部控制栏 (Top Bar - 64px) */}
      <header className="relative z-30 flex h-16 w-full shrink-0 items-center justify-between border-b border-[#21262D] bg-[#0D1117]/85 px-6 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <h1 className="font-data text-base font-bold tracking-widest text-[#00F0FF] flex items-center gap-2">
            <span className="h-3 w-3 bg-[#00F0FF] chamfer-sm"></span>
            ASTROMATRIX
          </h1>
          {/* 45° 梯形咬合面包屑 (带 min-w 保护) */}
          <InterlockingBreadcrumb
            galaxyName={data.hierarchy.galaxyName}
            sectorName={selectedNode.sectorName}
            nodeName={selectedNode.id}
            phase={state.phase}
          />
        </div>

        {/* 决策状态机与倒计时 */}
        <DecisionStatusBar state={state} />
      </header>

      {/* 中部核心交互视界 (Central Viewport - Flex 1) */}
      <main className="relative z-20 flex-1 w-full overflow-hidden flex">
        {/* 左侧悬浮 HUD：热负荷指数计量仪 (内部直连 MatrixEngine) */}
        <aside className="absolute left-6 top-6 z-30 w-72 pointer-events-none">
          <HeatIndexMeter phase={state.phase} />
        </aside>

        {/* 空间拓扑主画布 (Canvas 2D + 位移>15%直入Stage2 + 阻尼物理) */}
        <section id="topology-viewport" className="relative h-full w-full">
          <TopologyCanvas
            nodes={data.nodes}
            edges={data.edges}
            selectedNodeId={state.selectedNodeId}
            phase={state.phase}
            targetCoords={state.targetCoords}
            onSelectNode={actions.selectNode}
            onStartSimulation={actions.startSimulation}
            onUpdateCoords={actions.updateCoords}
            onEnterDecisionStage={actions.enterDecisionStage}
            onTriggerAbort={() => actions.triggerAbort('USER_CANCEL')}
            onCompleteRebound={actions.completeRebound}
          />
        </section>

        {/* 右侧悬浮 HUD：定轨参数卡片 */}
        <aside className="absolute right-6 top-6 z-30 w-80 pointer-events-none">
          <div className="chamfer-frame-md bg-[#00F0FF]/20 pointer-events-auto">
            <div className="chamfer-inner p-4 font-data text-xs backdrop-blur-md">
              <div className="flex justify-between text-[#8B949E] border-b border-[#21262D] pb-2">
                <span>TARGET ORBIT</span>
                <span>目标轨道锁定</span>
              </div>
              <div className="mt-3 space-y-1.5">
                <p className="flex justify-between">
                  <span className="text-[#8B949E]">选中节点:</span>
                  <span className="text-[#00F0FF] font-bold">{selectedNode.id}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[#8B949E]">基准速度:</span>
                  <span>{selectedNode.velocity.toFixed(2)} KM/S</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[#8B949E]">链路延迟:</span>
                  <span>{selectedNode.latency.toFixed(2)} MS</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[#8B949E]">推演阶段:</span>
                  <span className={state.phase === 'STAGE2_DECISION' ? 'text-[#F59E0B]' : 'text-[#00F0FF]'}>
                    {state.phase}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* 底部遥测示波器带 (Telemetry Viewport - 176px) */}
      <footer className="relative z-30 flex h-44 w-full shrink-0 items-stretch border-t border-[#21262D] bg-[#0D1117]/90 backdrop-blur-md">
        <div className="flex w-60 shrink-0 flex-col justify-center border-r border-[#21262D] px-6 font-data">
          <p className="text-xs text-[#8B949E]">TELEMETRY OSCILLOSCOPE</p>
          <p className="mt-2 text-sm flex justify-between">
            <span className="text-[#8B949E]">CH-01 速度波:</span>
            <span className="text-[#00F0FF]">{selectedNode.velocity.toFixed(2)} km/s</span>
          </p>
          <p className="mt-1 text-sm flex justify-between">
            <span className="text-[#8B949E]">CH-02 功率波:</span>
            <span className="text-[#F59E0B]">{selectedNode.signalPower.toFixed(1)} dBm</span>
          </p>
        </div>

        {/* 双轨余辉示波器主体 (内部直连 MatrixEngine) */}
        <div className="relative flex-1 min-w-0">
          <TelemetryScope phase={state.phase} velocity={selectedNode.velocity} />
        </div>

        {/* 右侧全局键盘矩阵与无障碍 */}
        <div className="flex w-80 shrink-0 items-center justify-end border-l border-[#21262D] px-6">
          <KeyboardMatrix
            phase={state.phase}
            onCommit={actions.commitDecision}
            onAbort={() => actions.triggerAbort('USER_CANCEL')}
          />
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <MatrixProvider>
      <AstroMatrixLayout />
    </MatrixProvider>
  );
}
```

### 6.5 `InterlockingBreadcrumb.tsx` (45° 梯形咬合面包屑 · 纯 CSS 零订阅)

```tsx
import React from 'react';
import { FSMPhase } from '../../types/fsm';

interface InterlockingBreadcrumbProps {
  galaxyName: string;
  sectorName: string;
  nodeName: string;
  phase: FSMPhase;
}

/**
 * 末段高亮色随决策状态机流转 (纯静态映射，绝不订阅 MatrixEngine)
 * STAGE2_DECISION → 琥珀金 / AUTO_ABORT → 品红 / 其余 → 青色
 */
const ACTIVE_COLOR_MAP: Record<FSMPhase, string> = {
  STABLE_IDLE: '#00F0FF',
  STAGE1_SIMULATION: '#00F0FF',
  STAGE2_DECISION: '#F59E0B',
  COMMITTED: '#00F0FF',
  AUTO_ABORT: '#FF0055',
};

export const InterlockingBreadcrumb: React.FC<InterlockingBreadcrumbProps> = ({
  galaxyName,
  sectorName,
  nodeName,
  phase,
}) => {
  const activeColor = ACTIVE_COLOR_MAP[phase];

  return (
    <nav aria-label="空间层级路径" className="flex min-w-0 items-stretch font-data text-xs">
      {/* 第一段：主星系 (crumb-lead 左端直角起头) */}
      <span
        className="crumb-lead flex items-center bg-[#161B22] px-3 py-1.5 text-[#8B949E]"
        title="主星系"
      >
        {galaxyName}
      </span>
      {/* 第二段：扇区 (crumb-tooth 45° 双侧咬合) */}
      <span
        className="crumb-tooth flex items-center bg-[#0D1117] px-4 py-1.5 text-[#8B949E]"
        title="扇区"
      >
        {sectorName}
      </span>
      {/* 第三段：当前节点 (高亮，文字与背景随 phase 变色，背景注入 10% 透明度) */}
      <span
        className="crumb-tooth flex items-center px-4 py-1.5 font-bold tracking-wider"
        style={{ color: activeColor, backgroundColor: `${activeColor}1A` }}
        title="当前节点"
      >
        {nodeName}
      </span>
    </nav>
  );
};
```

### 6.6 `DecisionStatusBar.tsx` (决策状态徽章与双阶段倒计时)

```tsx
import React from 'react';
import { DecisionState, FSMPhase } from '../../types/fsm';

/** phase 中文映射与主题色：稳态青 / 推演黄 / 决断琥珀 / 固化绿 / 熔断品红 */
const PHASE_META: Record<FSMPhase, { label: string; color: string }> = {
  STABLE_IDLE: { label: '稳态待命', color: '#00F0FF' },
  STAGE1_SIMULATION: { label: '全息推演', color: '#FACC15' },
  STAGE2_DECISION: { label: '决断窗口', color: '#F59E0B' },
  COMMITTED: { label: '已固化', color: '#3FB950' },
  AUTO_ABORT: { label: '熔断回弹', color: '#FF0055' },
};

export const DecisionStatusBar: React.FC<{ state: DecisionState }> = ({ state }) => {
  const meta = PHASE_META[state.phase];

  return (
    <div
      role="status"
      aria-label={`当前状态：${meta.label}`}
      className="flex items-center gap-3 font-data"
    >
      {/* 双层切角 badge：外层 1px 边框光随 phase 变色，内层保持面板底色 */}
      <div className="chamfer-frame-sm" style={{ background: `${meta.color}59` }}>
        <div className="chamfer-inner flex items-center gap-3 px-4 py-2">
          <span
            className="h-2 w-2 shrink-0"
            style={{ backgroundColor: meta.color }}
            aria-hidden="true"
          />
          <span className="text-[10px] tracking-[0.2em] text-[#8B949E]">SYS.PHASE</span>
          <span className="text-sm font-bold tracking-wider" style={{ color: meta.color }}>
            {meta.label}
          </span>

          {/* 阶段一：20s 推演倒计时 (黄色常规字号) */}
          {state.phase === 'STAGE1_SIMULATION' && (
            <span className="text-sm font-bold tabular-nums text-[#FACC15]">
              T-{state.stage1TimeRemaining.toFixed(1)}s
            </span>
          )}

          {/* 阶段二：10s 决断大字红色倒计时 */}
          {state.phase === 'STAGE2_DECISION' && (
            <span className="text-xl font-bold tabular-nums text-[#FF0055]">
              {state.stage2TimeRemaining.toFixed(1)}s
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
```

### 6.7 `DeepSpaceBackground.tsx` (纯 CSS+SVG 深渊星网 · 零 Canvas 零订阅)

> 【关键约束】拒绝第二块 Canvas：背景层完全静态，由 GPU 合成的 CSS 多层渐变 + 一次性内联 SVG 构成，无 RAF、无订阅、无逐帧重绘；`pointer-events: none` 保证不拦截拓扑画布的指针交互。

```tsx
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
```

---

## 7. 修复版 60 节点 Mock 生成器 (防自环边 + RELAY-2247 锁定)

```typescript
import { RelayNode, NetworkEdge, GalaxyHierarchy } from '../types/domain';

export function generateMockGalaxyData(): {
  nodes: Record<string, RelayNode>;
  edges: NetworkEdge[];
  hierarchy: GalaxyHierarchy;
} {
  const nodes: Record<string, RelayNode> = {};
  const edges: NetworkEdge[] = [];

  const sectors = [
    { id: 'SECTOR-01', name: '奥尔特前哨', count: 5 },
    { id: 'SECTOR-02', name: '柯伊伯中继带', count: 8 },
    { id: 'SECTOR-03', name: '主小行星场', count: 11 },
    { id: 'SECTOR-04', name: '深空扫描弧', count: 4 },
    { id: 'SECTOR-05', name: '轨道交汇区', count: 10 },
    { id: 'SECTOR-06', name: '长弧滞后区', count: 3 },
    { id: 'SECTOR-07', name: '核心定轨中继区', count: 8 }, // 包含 RELAY-2247
    { id: 'SECTOR-08', name: '极远端信标', count: 2 },
    { id: 'SECTOR-09', name: '汇聚扇区', count: 7 },
    { id: 'SECTOR-10', name: '待勘察外缘区', count: 2 },
  ];

  const hierarchy: GalaxyHierarchy = {
    galaxyId: 'KEPLER-90',
    galaxyName: '开普勒-90 主星系',
    sectors: [],
  };

  let totalNodeCounter = 1;

  sectors.forEach((sec, sIdx) => {
    const secNodeIds: string[] = [];

    for (let i = 0; i < sec.count; i++) {
      let id: string;
      let isPrimary = false;

      // 显式锁定核心交互主节点 RELAY-2247
      let isActive = false;
      if (sec.id === 'SECTOR-07' && i === 0) {
        id = 'RELAY-2247';
        isPrimary = true;
        isActive = true;
      } else {
        const padId = String(totalNodeCounter).padStart(4, '0');
        const type = totalNodeCounter % 3 === 0 ? 'RELAY' : (totalNodeCounter % 4 === 0 ? 'HUB' : 'PROBE');
        id = `${type}-${padId}`;
        // 规则 1：SECTOR-01 ~ SECTOR-05 各取首节点作为 ACTIVE，使活跃节点分散在画布不同区域
        // (SECTOR-07 首节点已被 RELAY-2247 占用，其余扇区首节点均满足"非 RELAY-2247"条件)
        isActive = i === 0 && ['SECTOR-01', 'SECTOR-02', 'SECTOR-03', 'SECTOR-04', 'SECTOR-05'].includes(sec.id);
      }

      const angle = (totalNodeCounter / 60) * Math.PI * 2 + (sIdx * 0.28);
      const radius = 22 + (sIdx * 5.5) + (i * 2.2);
      const cx = isPrimary ? 50 : Math.max(8, Math.min(92, 50 + Math.cos(angle) * (radius * 0.72)));
      const cy = isPrimary ? 48 : Math.max(8, Math.min(92, 50 + Math.sin(angle) * (radius * 0.52)));

      const node: RelayNode = {
        id,
        name: isPrimary ? '核心定轨中继 · RELAY-2247' : `${sec.name} · 节点 #${id}`,
        type: isPrimary ? 'RELAY' : (totalNodeCounter % 3 === 0 ? 'RELAY' : (totalNodeCounter % 4 === 0 ? 'HUB' : 'PROBE')),
        status: isActive ? 'ACTIVE' : 'IDLE',
        galaxyId: 'KEPLER-90',
        sectorId: sec.id,
        sectorName: sec.name,
        coords: { x: cx, y: cy },
        baseCoords: { x: cx, y: cy },
        velocity: isPrimary ? 7.84 : 6.8 + (totalNodeCounter % 15) * 0.14,
        latency: isPrimary ? 3.21 : 2.5 + (sIdx * 0.45),
        signalPower: isPrimary ? -62.4 : -55.0 - (sIdx * 2.1),
        payloadCapacity: isPrimary ? 0.62 : 0.3 + ((totalNodeCounter * 11) % 55) / 100,
      };

      nodes[id] = node;
      secNodeIds.push(id);
      totalNodeCounter++;
    }

    hierarchy.sectors.push({
      sectorId: sec.id,
      sectorName: sec.name,
      nodeIds: secNodeIds,
    });
  });

  // 构造 142 条连线并防自环边 (Self-Loop Guard)
  const allIds = Object.keys(nodes);
  const edgeSet = new Set<string>();

  allIds.forEach((nId, idx) => {
    const t1 = allIds[(idx + 1) % allIds.length];
    const t2 = allIds[(idx + 3) % allIds.length];

    if (t1 && t1 !== nId) {
      const key = [nId, t1].sort().join('-');
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ id: `edge-${nId}-${t1}`, sourceId: nId, targetId: t1, bandwidth: 40 });
      }
    }

    if (t2 && t2 !== nId) {
      const key = [nId, t2].sort().join('-');
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ id: `edge-${nId}-${t2}`, sourceId: nId, targetId: t2, bandwidth: 10 });
      }
    }

    if (idx % 3 === 0) {
      const t3 = allIds[(idx + 7) % allIds.length];
      if (t3 && t3 !== nId) {
        const key = [nId, t3].sort().join('-');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ id: `edge-${nId}-${t3}`, sourceId: nId, targetId: t3, bandwidth: 100 });
        }
      }
    }
  });

  // 注入主干强链路
  edges.push({ id: 'edge-main-1', sourceId: 'RELAY-2247', targetId: allIds[2], bandwidth: 120 });
  edges.push({ id: 'edge-main-2', sourceId: 'RELAY-2247', targetId: allIds[15], bandwidth: 120 });

  return { nodes, edges, hierarchy };
}
```

---

## 8. 项目启动与运行指引 (`README.md`)

```markdown
# AstroMatrix · 深空系外天体探索与空间中继指挥控制中枢

AstroMatrix 采用 45° 斜切角战术美学、两阶段决策状态机与 60FPS 双轨分流 Canvas 渲染架构。

## 快速上手

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器
```bash
npm run dev
```
打开浏览器访问：`http://localhost:3000`

### 3. 构建与代码质检
```bash
npm run build
npm run lint
```

## 核心交互操作流
1. **中继拖拽推演**：点击并拖拽处于高亮激活状态的 `RELAY-2247` 节点；
   - 移动超过 5px 即进入 `STAGE1_SIMULATION`（20 秒推演期），热负荷指数线性爬升；
   - 拖拽位移超过 15% 画布宽度或 20 秒倒计时结束，立即进入 `STAGE2_DECISION`（10 秒决断倒计时）；
2. **确认固化与超时熔断**：
   - 按 `Enter` 键确认锁定定轨 (`COMMITTED`)；
   - 按 `Esc` 键或 10 秒超时未决断触发 `AUTO_ABORT`，节点以 1.2 秒真实欠阻尼物理弹簧平滑回弹原位。
```
