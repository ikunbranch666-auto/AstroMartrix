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
