import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import ReviewPage from './ReviewPage';

export default function ReviewRoutePage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { onPromoted } = useAppState();
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const locationState = location.state as { sessionId?: string; sandboxTouched?: boolean } | null;

  return (
    <div className="app-page review-page app-page-fill">
      <ReviewPage
        initialSessionId={locationState?.sessionId || null}
        returnState={locationState}
        onPromoted={(_slug?: string): void => {
          setRefreshKey((k) => k + 1);
          navigate('/authoring', { replace: true });
          if (onPromoted) onPromoted();
        }}
        refreshKey={refreshKey}
      />
    </div>
  );
}
