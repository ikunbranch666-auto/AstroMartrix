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
