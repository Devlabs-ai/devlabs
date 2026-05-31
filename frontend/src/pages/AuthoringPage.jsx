import React from 'react';
import { useAppState } from '../context/AppStateContext.jsx';
import AuthoringWorkspace from './AuthoringWorkspace.jsx';

export default function AuthoringPage() {
  const { onPromoted } = useAppState();

  return (
    <div className="app-page authoring-page">
      <AuthoringWorkspace onPromoted={onPromoted} />
    </div>
  );
}
