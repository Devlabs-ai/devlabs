import React from 'react';
import { markdownExcerpt } from '../utils/markdownText.js';

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
            className={`card challenge-card ${playable ? '' : 'coming-soon'}`}
            data-bucket={c.bucket || '__unbucketed__'}
            onClick={() => playable && onSelect && onSelect(c)}
            role={playable ? 'button' : undefined}
            tabIndex={playable ? 0 : undefined}
            onKeyDown={(e) => {
              if (!playable || !onSelect) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(c);
              }
            }}
          >
            <div className="challenge-card-top">
              <span className={`pill ${difficultyClass(c.difficulty)}`}>{c.difficulty}</span>
              {c.category && <span className="challenge-card-category">{c.category}</span>}
            </div>
            <h3>{c.title}</h3>
            <p className="challenge-card-description">
              {markdownExcerpt(c.description || '', { maxLen: 140, title: c.title })}
            </p>
            <div className="challenge-card-footer">
              <div className="meta">
                {(c.tags || []).slice(0, 4).map((t) => (
                  <span key={t} className="tag">{t}</span>
                ))}
                {!playable && <span className="tag">Coming soon</span>}
              </div>
              {playable && (
                <span className="challenge-card-cta" aria-hidden>
                  Play <span className="arrow">→</span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
