import React, { useEffect, useState } from 'react';
import type { ActiveSession } from '../types/domain';

interface SessionControllerProps {
  session: ActiveSession;
  onEnd: () => void;
  ending: boolean;
}

export default function SessionController({ session, onEnd, ending }: SessionControllerProps): JSX.Element {
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
