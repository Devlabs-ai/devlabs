import React, { createContext, useContext } from 'react';
import type { AppState } from '../types/domain';

const AppStateContext = createContext<AppState | null>(null);

interface AppStateProviderProps {
  value: AppState;
  children: React.ReactNode;
}

export function AppStateProvider({ value, children }: AppStateProviderProps): JSX.Element {
  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return ctx;
}
