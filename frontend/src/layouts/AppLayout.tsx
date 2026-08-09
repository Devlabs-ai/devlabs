import React from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import SessionController from '../components/SessionController';
import { useAppState } from '../context/AppStateContext';
import { PlayChromeProvider } from '../context/PlayChromeContext';

/** Thin brand bar — Run/Submit live in the IDE action bar (TensorTonic-style). */
function ChallengeTopBar(): JSX.Element {
  return (
    <div className="topbar topbar--challenge">
      <div className="topbar-inner topbar-inner--challenge">
        <div className="challenge-chrome-left">
          <Link to="/" className="brand brand--compact brand-link" title="Home">
            <BrandMark className="brand-mark brand-mark--sm" />
            DevLabs
          </Link>
        </div>
        <div className="challenge-chrome-center" />
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
  const challengeOpen = playState === 'active' && Boolean(activeSession);
  const showNav = authMode === 'interviewer' && playState !== 'active';
  const onPlayRoute =
    location.pathname === '/play' ||
    (location.pathname.startsWith('/play/') &&
      !location.pathname.startsWith('/play/quiz/') &&
      !location.pathname.startsWith('/play/papers') &&
      !location.pathname.startsWith('/play/quests'));
  const usePlayChrome =
    (onPlayRoute ||
      location.pathname.startsWith('/play/quiz/') ||
      location.pathname.startsWith('/play/papers') ||
      location.pathname.startsWith('/play/quests')) &&
    !challengeOpen;

  return (
    <div className={`app${challengeOpen ? ' app--challenge' : ''}${usePlayChrome ? ' app--play' : ''}`}>
      {challengeOpen ? (
        <ChallengeTopBar />
      ) : (
        <header className={`topbar${usePlayChrome ? ' topbar--play' : ''}`}>
          <div className="topbar-inner topbar-inner--play">
            <NavLink to="/" className="brand brand-link" end title="Home">
              <BrandMark className="brand-mark" />
              <span className="brand-name">DevLabs</span>
              {!usePlayChrome && <span className="sub">v0.2</span>}
            </NavLink>

            <div className="topbar-trailing">
              {playState === 'active' && activeSession && (
                <SessionController
                  session={activeSession}
                  onEnd={onEnd}
                  ending={ending}
                />
              )}

              {showNav && (
                <nav className="topnav topnav--actions" aria-label="Account">
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
        </header>
      )}

      <div className={`app-body${challengeOpen ? ' app-body--challenge' : ''}`}>
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
