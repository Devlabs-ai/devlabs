import React from 'react';
import { useAppState } from '../context/AppStateContext';
import AuthoringWorkspace from './AuthoringWorkspace';

export default function AuthoringPage(): JSX.Element {
  const { onPromoted } = useAppState();

  return (
    <div className="app-page authoring-page">
      <AuthoringWorkspace onPromoted={onPromoted} />
    </div>
  );
}
