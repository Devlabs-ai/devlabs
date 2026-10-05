import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';

export function useIsAdmin(): boolean {
  const { currentUser } = useAppState();
  return isAdminUser(currentUser);
}

/** Sends non-admins back to the catalog. */
export default function AdminOnlyRoute({ children }: { children: React.ReactElement }): React.ReactElement {
  return useIsAdmin() ? children : <Navigate to="/track" replace />;
}
