import React from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import SessionController from '../components/SessionController';
import { useAppState } from '../context/AppStateContext';
import { PlayChromeProvider } from '../context/PlayChromeContext';
import { PLAYGROUNDS_PATH, SPARK_PLAYGROUND_PATH } from '../constants/playgrounds';
import { MAJORS_PATH } from '../constants/projects';
import { MINORS_PATH } from '../constants/minors';

/** Play routes that bring their own page chrome instead of the catalog's. */
const PLAY_SUBROUTES = [
  '/play/quiz/',
  '/play/papers',
  '/play/quests',
  PLAYGROUNDS_PATH,
  MAJORS_PATH,
  MINORS_PATH,
  '/play/projects',
  SPARK_PLAYGROUND_PATH,
];

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
  const onPlaySubroute = PLAY_SUBROUTES.some((p) => location.pathname.startsWith(p));
  const onPlayRoute =
    location.pathname === '/play' ||
    (location.pathname.startsWith('/play/') && !onPlaySubroute);
  const usePlayChrome = (onPlayRoute || onPlaySubroute) && !challengeOpen;
  // The Spark bench is reached through the index, so keep the pill lit inside it.
  const playgroundsActive =
    location.pathname.startsWith(PLAYGROUNDS_PATH) ||
    location.pathname.startsWith(SPARK_PLAYGROUND_PATH);

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
                <nav className="topnav topnav--actions" aria-label="Sections">
                  <NavLink
                    to={MAJORS_PATH}
                    className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
                  >
                    Majors
                  </NavLink>
                  <NavLink
                    to={MINORS_PATH}
                    className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
                  >
                    Minors
                  </NavLink>
                  <NavLink
                    to={PLAYGROUNDS_PATH}
                    className={`topnav-pill topnav-action${playgroundsActive ? ' active' : ''}`}
                  >
                    Playgrounds
                  </NavLink>
                </nav>
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
