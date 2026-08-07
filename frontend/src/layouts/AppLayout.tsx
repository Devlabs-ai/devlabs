import React from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import SessionController from '../components/SessionController';
import {
  IconPlay,
  IconSubmit,
  IconSubmissions,
} from '../components/ChromeIcons';
import { useAppState } from '../context/AppStateContext';
import { PlayChromeProvider, usePlayChrome } from '../context/PlayChromeContext';

const CHROME_ACTION_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '4px 8px',
  margin: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  boxShadow: 'none',
  color: '#34d399',
  fontSize: 13,
  fontWeight: 600,
  filter: 'none',
  transform: 'none',
  letterSpacing: 'normal',
};

function ChallengeTopBar(): JSX.Element {
  const { chrome } = usePlayChrome();

  const showRun = Boolean(chrome.run || chrome.primary);
  const runBusy = Boolean(chrome.run?.busy || chrome.primary?.busy);

  return (
    <div className="topbar topbar--challenge">
      <div className="topbar-inner topbar-inner--challenge">
        <div className="challenge-chrome-left">
          <Link to="/" className="brand brand--compact brand-link" title="Home">
            <span className="logo-dot" />
            Devlabs
          </Link>
        </div>

        <div className="challenge-chrome-center">
          {showRun && (
            <button
              type="button"
              className="challenge-chrome-submit"
              onClick={chrome.run?.onClick}
              disabled={!chrome.run || runBusy}
              title="Run"
              style={{
                ...CHROME_ACTION_STYLE,
                cursor: !chrome.run || runBusy ? 'not-allowed' : 'pointer',
                opacity: !chrome.run || runBusy ? 0.55 : 1,
              }}
            >
              <IconPlay color="#34d399" />
              <span>{chrome.run?.busy ? (chrome.run.busyLabel || 'Running…') : 'Run'}</span>
            </button>
          )}
          {chrome.primary && (
            <button
              type="button"
              className="challenge-chrome-submit"
              onClick={chrome.primary.onClick}
              disabled={chrome.primary.busy}
              title={chrome.primary.busy
                ? (chrome.primary.busyLabel || chrome.primary.label)
                : chrome.primary.label}
              style={{
                ...CHROME_ACTION_STYLE,
                cursor: chrome.primary.busy ? 'not-allowed' : 'pointer',
                opacity: chrome.primary.busy ? 0.55 : 1,
              }}
            >
              <IconSubmit />
              <span>
                {chrome.primary.busy
                  ? (chrome.primary.busyLabel || chrome.primary.label)
                  : chrome.primary.label}
              </span>
            </button>
          )}
          {chrome.submissions && (
            <button
              type="button"
              className="challenge-chrome-submit"
              onClick={chrome.submissions.onClick}
              disabled={chrome.submissions.busy}
              title={chrome.submissions.label}
              style={{
                ...CHROME_ACTION_STYLE,
                cursor: chrome.submissions.busy ? 'not-allowed' : 'pointer',
                opacity: chrome.submissions.busy ? 0.55 : 1,
              }}
            >
              <IconSubmissions />
              <span>{chrome.submissions.label}</span>
            </button>
          )}
          {chrome.status}
        </div>

        <div className="challenge-chrome-right" />
      </div>
    </div>
  );
}

function AppLayoutInner(): React.JSX.Element {
  const {
    authMode,
    playState,
    activeSession,
    ending,
    onEnd,
    onLogout,
  } = useAppState();

  const location = useLocation();
  const reviewSandboxOpen = /^\/review\/[^/]+\/sandbox/.test(location.pathname);
  const challengeOpen = playState === 'active' && Boolean(activeSession);
  const showNav = authMode === 'interviewer' && playState !== 'active' && !reviewSandboxOpen;

  return (
    <div className={`app${challengeOpen ? ' app--challenge' : ''}`}>
      {challengeOpen ? (
        <ChallengeTopBar />
      ) : (
        <div className="topbar">
          <div className="topbar-inner topbar-inner--split">
            <NavLink to="/" className="brand brand-link" end title="Home">
              <span className="logo-dot" />
              Devlabs
              <span className="sub">v0.2</span>
            </NavLink>

            <div className="right">
              {playState === 'active' && activeSession && (
                <SessionController
                  session={activeSession}
                  onEnd={onEnd}
                  ending={ending}
                />
              )}

              {showNav && (
                <nav className="topnav">
                  <NavLink
                    to="/play"
                    className={({ isActive }) => `topnav-pill${isActive || location.pathname.startsWith('/play') ? ' active' : ''}`}
                  >
                    Play
                  </NavLink>
                  <NavLink to="/authoring" className={({ isActive }) => `topnav-pill${isActive ? ' active' : ''}`}>Author</NavLink>
                  <NavLink
                    to="/review"
                    className={({ isActive }) => {
                      const onReview = isActive || location.pathname.startsWith('/review/');
                      return `topnav-pill${onReview ? ' active' : ''}`;
                    }}
                  >
                    Review
                  </NavLink>

                  <span className="topnav-sep" />

                  <NavLink
                    to="/profile"
                    className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
                  >
                    Profile
                  </NavLink>
                  <button type="button" className="topnav-pill topnav-action topnav-signout" onClick={onLogout}>
                    Sign out
                  </button>
                </nav>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`app-body${reviewSandboxOpen ? ' app-body--review-sandbox' : ''}${challengeOpen ? ' app-body--challenge' : ''}`}>
        <Outlet />
      </div>
    </div>
  );
}

export default function AppLayout(): React.JSX.Element {
  return (
    <PlayChromeProvider>
      <AppLayoutInner />
    </PlayChromeProvider>
  );
}
