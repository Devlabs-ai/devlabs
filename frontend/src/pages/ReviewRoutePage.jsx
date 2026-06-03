import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext.jsx';
import AppPageHeader from '../components/AppPageHeader.jsx';
import ReviewPage from './ReviewPage.jsx';

export default function ReviewRoutePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { onPromoted } = useAppState();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="app-page review-page app-page-fill">
      <AppPageHeader
        eyebrow="Review"
        title="Ship builds"
        lead="Validate sandboxes from successful pipeline runs, then ship challenges to your library."
        className="review-page-header"
      />
      <ReviewPage
        initialSessionId={location.state?.sessionId || null}
        returnState={location.state}
        onPromoted={(slug) => {
          setRefreshKey((k) => k + 1);
          navigate('/authoring', { replace: true });
          if (onPromoted) onPromoted(slug);
        }}
        refreshKey={refreshKey}
      />
    </div>
  );
}
