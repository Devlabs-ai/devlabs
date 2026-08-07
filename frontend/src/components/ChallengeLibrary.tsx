import React, { useEffect, useRef, useState } from 'react';
import { markdownExcerpt } from '../utils/markdownText';
import type { ChallengePublic } from '../types/domain';

interface ChallengeLibraryProps {
  challenges: ChallengePublic[];
  onSelect?: (challenge: ChallengePublic) => void;
  showCardMenu?: boolean;
  onShareChallenge?: (challenge: ChallengePublic) => void;
}

function difficultyClass(d: string | undefined): string {
  const s = (d || '').toLowerCase();
  if (s.includes('easy')) return 'easy';
  if (s.includes('hard')) return 'hard';
  return 'medium';
}

export default function ChallengeLibrary({
  challenges,
  onSelect,
  showCardMenu = false,
  onShareChallenge,
}: ChallengeLibraryProps): JSX.Element {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const handler = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [openMenuId]);

  if (!challenges || challenges.length === 0) {
    return <div className="alert info">No challenges loaded yet.</div>;
  }

  return (
    <div className="card-grid">
      {challenges.map((c) => {
        const playable = !!c.finalized;
        const canShare = showCardMenu && playable && onShareChallenge;
        const menuOpen = openMenuId === c.id;

        return (
          <div
            key={c.id}
            className={`card challenge-card ${playable ? '' : 'coming-soon'}`}
            onClick={() => playable && onSelect && onSelect(c)}
            role={playable ? 'button' : undefined}
            tabIndex={playable ? 0 : undefined}
            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
              if (!playable || !onSelect) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(c);
              }
            }}
          >
            <div className="challenge-card-top challenge-card-top-row">
              <div className="challenge-card-top-meta">
                <span className={`pill ${difficultyClass(c.difficulty)}`}>{c.difficulty}</span>
                {(c.sandboxType || '') === 'spark-platform' && (
                  <span className="pill spark-runtime-pill">Spark</span>
                )}
                {c.category && <span className="challenge-card-category">{c.category}</span>}
              </div>
              {canShare && (
                <div
                  className="challenge-card-menu"
                  ref={menuOpen ? menuRef : null}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="challenge-card-menu-btn"
                    aria-label="Challenge options"
                    aria-expanded={menuOpen}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      setOpenMenuId((prev) => (prev === c.id ? null : c.id));
                    }}
                  >
                    ⋯
                  </button>
                  {menuOpen && (
                    <div className="challenge-card-dropdown" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          onShareChallenge(c);
                        }}
                      >
                        Share
                      </button>
                    </div>
                  )}
                </div>
              )}
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
