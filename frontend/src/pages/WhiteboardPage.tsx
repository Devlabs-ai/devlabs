import React, { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isBoardChallenge } from '../components/BoardWorkspace';
import { markdownExcerpt } from '../utils/markdownText';
import {
  WHITEBOARD_PATH,
  WHITEBOARD_SECTIONS,
  challengeMatchesWhiteboardSection,
  getWhiteboardSection,
  whiteboardSectionPath,
} from '../constants/whiteboard';

export default function WhiteboardPage(): JSX.Element {
  const { sectionId } = useParams<{ sectionId?: string }>();
  const {
    challenges,
    challengesError,
    startError,
    onSelectChallenge,
  } = useAppState();

  const boards = useMemo(
    () =>
      challenges
        .filter((c) => isBoardChallenge(c))
        .sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999)),
    [challenges],
  );

  const section = getWhiteboardSection(sectionId);
  const sectionBoards = useMemo(
    () => (section ? boards.filter((c) => challengeMatchesWhiteboardSection(c.tags, section)) : []),
    [boards, section],
  );

  if (sectionId && !section) {
    return <Navigate to={WHITEBOARD_PATH} replace />;
  }

  if (section) {
    return (
      <div className="app-page play-problems-page play-papers-page">
        <header className="play-problems-hero">
          <div className="play-problems-hero-copy">
            <p className="play-problems-kicker">
              <Link to={WHITEBOARD_PATH} className="play-papers-crumb">
                Whiteboard
              </Link>
              <span aria-hidden> / </span>
              {section.label}
            </p>
            <h1 className="play-problems-title">{section.label}</h1>
            <p className="play-problems-lead">{section.blurb}</p>
          </div>
        </header>

        {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
        {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

        {sectionBoards.length === 0 && !challengesError && (
          <div className="alert info">No {section.label} boards published yet.</div>
        )}

        {sectionBoards.length > 0 && (
          <div className="play-paper-tile-grid" aria-label={`${section.label} whiteboard sessions`}>
            {sectionBoards.map((challenge) => {
              const playable = Boolean(challenge.finalized);
              return (
                <button
                  key={challenge.id}
                  type="button"
                className={`play-paper-tile play-quest-tile play-board-tile${playable ? '' : ' play-paper-tile--soon'}`}
                disabled={!playable}
                onClick={() => {
                  if (playable) void onSelectChallenge(challenge);
                }}
                title={challenge.description}
              >
                {challenge.solved && (
                  <span className="play-paper-tile-meta">Solved</span>
                )}
                <strong className="play-paper-tile-title">{challenge.title}</strong>
                <p className="play-paper-tile-blurb">
                  {markdownExcerpt(challenge.description, { maxLen: 110, title: challenge.title })}
                </p>
                  <span className="play-paper-tile-cta">
                    {playable ? 'Open board' : 'Coming soon'}
                    <span aria-hidden>→</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-page play-problems-page play-papers-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <p className="play-papers-crumb">
            <Link to="/play">Play</Link>
            <span aria-hidden> / </span>
            <span>Whiteboard</span>
          </p>
          <h1 className="play-problems-title">Whiteboard</h1>
          <p className="play-problems-lead">
            Reconstruct what the engine does. The plan’s outline is given; you fill the blocks. No cluster.
          </p>
        </div>
      </header>

      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

      <div className="play-paper-section-grid" aria-label="Whiteboard sections">
        {WHITEBOARD_SECTIONS.map((s) => {
          const count = boards.filter((c) => challengeMatchesWhiteboardSection(c.tags, s)).length;
          return (
            <Link
              key={s.id}
              to={whiteboardSectionPath(s.id)}
              className="play-paper-section-card"
            >
              <span className="play-paper-section-kicker">
                {count} board{count === 1 ? '' : 's'}
              </span>
              <strong className="play-paper-section-title">{s.label}</strong>
              <p className="play-paper-section-blurb">{s.blurb}</p>
              <span className="play-paper-section-cta">
                Browse
                <span aria-hidden>→</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
