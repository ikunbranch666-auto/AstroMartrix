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
