import React from 'react';
import { useAppState } from '../context/AppStateContext';

/** Leading "‹ Back" in a workspace's brief tab row; leaves the lab for its catalog. */
export default function BriefBackButton(): JSX.Element {
  const { onBackToLibrary, ending } = useAppState();
  return (
    <>
      <button
        type="button"
        className="spark-brief-back"
        onClick={onBackToLibrary}
        disabled={ending}
        title="Back to labs"
        aria-label="Back to labs"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M10 3.5 5.5 8 10 12.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="spark-brief-back-label">Back</span>
      </button>
      <span className="spark-brief-back-divider" aria-hidden="true" />
    </>
  );
}
