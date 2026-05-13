import React from 'react';

function difficultyClass(d) {
  const s = (d || '').toLowerCase();
  if (s.includes('easy')) return 'easy';
  if (s.includes('hard')) return 'hard';
  return 'medium';
}

export default function ChallengeLibrary({ challenges, onSelect }) {
  if (!challenges || challenges.length === 0) {
    return <div className="alert info">No challenges loaded yet.</div>;
  }
  return (
    <div className="card-grid">
      {challenges.map((c) => {
        const playable = c.finalized;
        return (
          <div
            key={c.id}
            className={`card ${playable ? '' : 'coming-soon'}`}
            onClick={() => playable && onSelect && onSelect(c)}
          >
            <div className="difficulty">
              <span className={`pill ${difficultyClass(c.difficulty)}`}>{c.difficulty}</span>
              <span>{c.category}</span>
            </div>
            <h3>{c.title}</h3>
            <div className="description">
              {(c.description || '').slice(0, 140)}
              {c.description && c.description.length > 140 ? '…' : ''}
            </div>
            <div className="meta">
              {(c.tags || []).map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              {!playable && <span className="tag">Coming soon</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
