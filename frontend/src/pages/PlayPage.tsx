import React, { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import AppPageHeader from '../components/AppPageHeader';
import ChallengeLibrary from '../components/ChallengeLibrary';
import SandboxWorkspace from '../components/SandboxWorkspace';
import SparkPlatformWorkspace, {
  isSparkPlatformChallenge,
} from '../components/SparkPlatformWorkspace';
import {
  PLAY_DOMAINS,
  getPlayDomain,
  getPlayPanel,
  isPlayDomainId,
  looksLikePlaySessionId,
  playCatalogPath,
  type PlayDomainId,
} from '../constants/playCatalog';
import type { ChallengePublic } from '../types/domain';

interface LibraryViewProps {
  challenges: ChallengePublic[];
  challengesError: string | null;
  startError: string | null;
  onSelectChallenge: (challenge: ChallengePublic) => void | Promise<void>;
}

function LibraryView({ challenges, challengesError, startError, onSelectChallenge }: LibraryViewProps): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ domainId?: string; panelId?: string }>();

  const domainId = isPlayDomainId(params.domainId) ? (params.domainId as PlayDomainId) : null;
  const domain = getPlayDomain(domainId);
  const panel = getPlayPanel(domain, params.panelId || null);

  // Invalid domain slug → home. Unknown panel under a valid domain → domain page.
  // Session UUIDs share /play/:id with domains — leave those for App session restore.
  useEffect(() => {
    if (params.domainId && !domainId) {
      if (looksLikePlaySessionId(params.domainId)) return;
      navigate('/play', { replace: true });
      return;
    }
    if (domainId && params.panelId && !panel) {
      navigate(playCatalogPath(domainId), { replace: true });
    }
  }, [params.domainId, params.panelId, domainId, panel, navigate]);

  const byId = useMemo(() => {
    const map = new Map<string, ChallengePublic>();
    for (const c of challenges) map.set(c.id, c);
    return map;
  }, [challenges]);

  const panelChallenges = useMemo(() => {
    if (!panel) return [];
    return panel.challengeIds
      .map((id) => byId.get(id))
      .filter((c): c is ChallengePublic => Boolean(c));
  }, [panel, byId]);

  let title = 'Play';
  let lead = 'Choose an engineering track, then open a lab.';
  if (domain && !panel) {
    title = domain.label;
    lead = domain.blurb;
  } else if (domain && panel) {
    title = panel.label;
    lead = panel.blurb;
  }

  return (
    <div className="app-page play-catalog-page">
      {challengesError && <div className="alert app-page-alert">{challengesError}</div>}
      {startError && <div className="alert app-page-alert">Failed to start: {startError}</div>}

      <AppPageHeader
        eyebrow="Library"
        title={title}
        lead={lead}
        aside={
          (domain || panel) ? (
            <nav className="play-catalog-crumb" aria-label="Catalog breadcrumb">
              <Link to="/play" className="ghost sm play-catalog-crumb-link">
                All tracks
              </Link>
              {domain && (
                <>
                  <span className="play-catalog-crumb-sep" aria-hidden>/</span>
                  {panel ? (
                    <Link to={playCatalogPath(domain.id)} className="ghost sm play-catalog-crumb-link">
                      {domain.label}
                    </Link>
                  ) : (
                    <span className="play-catalog-crumb-current">{domain.label}</span>
                  )}
                </>
              )}
              {panel && (
                <>
                  <span className="play-catalog-crumb-sep" aria-hidden>/</span>
                  <span className="play-catalog-crumb-current">{panel.label}</span>
                </>
              )}
            </nav>
          ) : null
        }
      />

      {!domain && (
        <div className="card-grid">
          {PLAY_DOMAINS.map((d) => {
            const challengeCount = d.panels.reduce((n, p) => n + p.challengeIds.length, 0);
            const comingSoon = d.panels.length === 0;
            const body = (
              <>
                <div className="challenge-card-top challenge-card-top-row">
                  <div className="challenge-card-top-meta">
                    <span className="pill">Track</span>
                    <span className="challenge-card-category">Engineering</span>
                  </div>
                </div>
                <h3>{d.label}</h3>
                <p className="challenge-card-description">{d.blurb}</p>
                <div className="challenge-card-footer">
                  <div className="meta">
                    {comingSoon ? (
                      <span className="tag">Coming soon</span>
                    ) : (
                      <>
                        <span className="tag">
                          {d.panels.length} panel{d.panels.length === 1 ? '' : 's'}
                        </span>
                        <span className="tag">
                          {challengeCount} lab{challengeCount === 1 ? '' : 's'}
                        </span>
                      </>
                    )}
                  </div>
                  {!comingSoon && (
                    <span className="challenge-card-cta" aria-hidden>
                      Browse <span className="arrow">→</span>
                    </span>
                  )}
                </div>
              </>
            );
            if (comingSoon) {
              return (
                <div key={d.id} className="card challenge-card coming-soon">
                  {body}
                </div>
              );
            }
            return (
              <Link key={d.id} to={playCatalogPath(d.id)} className="card challenge-card play-catalog-card">
                {body}
              </Link>
            );
          })}
        </div>
      )}

      {domain && !panel && (
        domain.panels.length === 0 ? (
          <div className="alert info">Labs for this track are coming soon.</div>
        ) : (
          <div className="card-grid">
            {domain.panels.map((p) => {
              const count = p.challengeIds.filter((id) => byId.has(id)).length;
              const comingSoon = p.challengeIds.length === 0;
              const body = (
                <>
                  <div className="challenge-card-top challenge-card-top-row">
                    <div className="challenge-card-top-meta">
                      <span className="pill medium">Platform</span>
                      <span className="challenge-card-category">{domain.label}</span>
                    </div>
                  </div>
                  <h3>{p.label}</h3>
                  <p className="challenge-card-description">{p.blurb}</p>
                  <div className="challenge-card-footer">
                    <div className="meta">
                      {comingSoon ? (
                        <span className="tag">Coming soon</span>
                      ) : (
                        <span className="tag">
                          {count} lab{count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {!comingSoon && (
                      <span className="challenge-card-cta" aria-hidden>
                        Open <span className="arrow">→</span>
                      </span>
                    )}
                  </div>
                </>
              );
              if (comingSoon) {
                return (
                  <div key={p.id} className="card challenge-card coming-soon">
                    {body}
                  </div>
                );
              }
              return (
                <Link
                  key={p.id}
                  to={playCatalogPath(domain.id, p.id)}
                  className="card challenge-card play-catalog-card"
                >
                  {body}
                </Link>
              );
            })}
          </div>
        )
      )}

      {domain && panel && (
        panelChallenges.length === 0 ? (
          <div className="alert info">
            {panel.challengeIds.length === 0
              ? `${panel.label} labs are coming soon.`
              : 'No matching challenges loaded from the catalog yet.'}
          </div>
        ) : (
          <ChallengeLibrary
            challenges={panelChallenges}
            onSelect={onSelectChallenge}
            showCardMenu={false}
          />
        )
      )}
    </div>
  );
}

export default function PlayPage(): JSX.Element | null {
  const {
    playState,
    challenges,
    challengesError,
    startError,
    activeSession,
    activeChallenge,
    endResult,
    onSelectChallenge,
    onBackToLibrary,
  } = useAppState();
  const params = useParams<{ domainId?: string; panelId?: string }>();
  const restoringSession =
    playState === 'library' &&
    Boolean(params.domainId) &&
    !params.panelId &&
    looksLikePlaySessionId(params.domainId);

  if (restoringSession || playState === 'loading') {
    const spark = isSparkPlatformChallenge(activeChallenge);
    return (
      <div className="app-page app-page-centered">
        <div className="loading-card app-surface-card">
          <span className="spinner" />
          <div>
            {spark ? (
              <>
                Opening Spark workspace for <strong>{activeChallenge?.title}</strong>…
                <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
                  Shared cluster session — no Docker sandbox to build.
                </div>
              </>
            ) : (
              <>
                {restoringSession ? (
                  <>Restoring session…</>
                ) : (
                  <>
                    Spinning up sandbox for <strong>{activeChallenge?.title}</strong>…
                    <div style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 6 }}>
                      This can take 30–60 seconds the first time while Docker images build.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (playState === 'library') {
    return (
      <LibraryView
        challenges={challenges}
        challengesError={challengesError}
        startError={startError}
        onSelectChallenge={onSelectChallenge}
      />
    );
  }

  if (playState === 'active' && activeSession) {
    if (isSparkPlatformChallenge(activeChallenge) || activeSession.runtime === 'spark-platform') {
      return (
        <SparkPlatformWorkspace
          challenge={activeChallenge}
          session={activeSession}
          onClose={onBackToLibrary}
        />
      );
    }
    return (
      <SandboxWorkspace
        challenge={activeChallenge}
        session={activeSession}
      />
    );
  }

  if (playState === 'ended' && endResult) {
    const result = endResult as { elapsed?: number };
    const spark = activeSession?.runtime === 'spark-platform';
    return (
      <div className="app-page app-page-centered">
        <div className="score-card app-surface-card">
          <h2>Session ended</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>
            Elapsed: {Math.floor((result.elapsed ?? 0) / 1000)}s
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 20px' }}>
            {spark
              ? 'Platform session closed. Evaluate the candidate from job outputs and your notes.'
              : 'The sandbox has been torn down. Evaluate the candidate from your notes.'}
          </p>
          <button type="button" onClick={onBackToLibrary}>
            Back to library
          </button>
        </div>
      </div>
    );
  }

  return null;
}
