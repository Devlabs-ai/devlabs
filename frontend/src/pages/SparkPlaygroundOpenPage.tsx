import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';

/** `/play/spark-playground/open` — starts a session (works for new-tab / middle-click). */
export default function SparkPlaygroundOpenPage(): JSX.Element {
  const { onOpenSparkPlayground, startError } = useAppState();
  const startedRef = useRef(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current || !onOpenSparkPlayground) return;
    startedRef.current = true;
    void onOpenSparkPlayground().catch((e: unknown) => {
      const err = e as { message?: string };
      setLocalError(err.message || 'Failed to open Spark Playground');
    });
  }, [onOpenSparkPlayground]);

  const error = localError || startError;

  return (
    <div className="app-page play-problems-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-papers-crumb">
            <Link to="/play">Play</Link>
            <span aria-hidden> / </span>
            <Link to="/play/spark-playground">Spark Playground</Link>
            <span aria-hidden> / </span>
            <span>Open</span>
          </p>
          <h1 className="play-problems-title">
            {error ? 'Could not open playground' : 'Opening playground…'}
          </h1>
          {!error && (
            <p className="play-problems-lead">
              Starting a Spark session on the shared trail.
            </p>
          )}
        </div>
      </header>

      {error && (
        <div className="alert error">
          {error}
          {' '}
          <Link to="/play/spark-playground">Back to catalog</Link>
        </div>
      )}
    </div>
  );
}
