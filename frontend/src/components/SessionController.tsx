import React, { useEffect, useState } from 'react';
import { ChromeIconButton, IconClock, IconStop } from './ChromeIcons';
import type { ActiveSession } from '../types/domain';

interface SessionControllerProps {
  session: ActiveSession;
  onEnd: () => void;
  ending: boolean;
  /** Slim inline controls for the challenge immersion header. */
  compact?: boolean;
}

export default function SessionController({
  session,
  onEnd,
  ending,
  compact = false,
}: SessionControllerProps): JSX.Element {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    if (!session?.startTime) return undefined;
    const tick = (): void => setElapsed(Math.floor((Date.now() - session.startTime) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.startTime]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  if (compact) {
    return (
      <div className="controller controller--compact">
        <span className="challenge-chrome-timer" title={`Elapsed ${mm}:${ss}`}>
          <IconClock />
          <span className="challenge-chrome-timer-value">{mm}:{ss}</span>
        </span>
        {session.recovered && (
          <span className="challenge-chrome-recovered" title="Session recovered">
            <span className="dot" />
          </span>
        )}
        <ChromeIconButton
          title={ending ? 'Ending…' : 'End session'}
          onClick={onEnd}
          disabled={ending}
          tone="danger"
        >
          <IconStop />
        </ChromeIconButton>
      </div>
    );
  }

  return (
    <div className="controller">
      <div className="timer">
        <span className="label">Elapsed</span>
        {mm}:{ss}
      </div>
      {session.recovered && (
        <span className="badge brand"><span className="dot" /> Recovered</span>
      )}
      <button className="danger" disabled={ending} onClick={onEnd}>
        {ending ? 'Ending…' : 'End session'}
      </button>
    </div>
  );
}
