import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { PlayChromeProvider } from '../context/PlayChromeContext';
import { PLAYGROUNDS_PATH, SPARK_PLAYGROUND_PATH } from '../constants/playgrounds';
import { MAJORS_PATH } from '../constants/projects';
import { MINORS_PATH } from '../constants/minors';
import { WHITEBOARD_PATH } from '../constants/whiteboard';
import { useIsNarrowUi } from '../hooks/useMediaQuery';

const PAPERS_PATH = '/play/papers';

/** Play routes that bring their own page chrome instead of the catalog's. */
const PLAY_SUBROUTES = [
  '/play/quiz/',
  PAPERS_PATH,
  '/play/quests',
  PLAYGROUNDS_PATH,
  MAJORS_PATH,
  MINORS_PATH,
  WHITEBOARD_PATH,
  '/play/projects',
  SPARK_PLAYGROUND_PATH,
];

/** Thin brand bar — session actions live in the workspace, not the header. */
function ChallengeTopBar(): JSX.Element {
  return (
    <div className="topbar topbar--challenge">
      <div className="topbar-inner topbar-inner--challenge">
        <div className="challenge-chrome-left">
          <Link to="/" className="brand brand--compact brand-link" title="Home">
            <BrandMark className="brand-mark brand-mark--sm" />
            DevSetu
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
    currentUser,
  } = useAppState();

  const location = useLocation();
  const isNarrow = useIsNarrowUi();
  const [navOpen, setNavOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const challengeOpen = playState === 'active' && Boolean(activeSession);
  const showNav = authMode === 'interviewer' && playState !== 'active';
  const showAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);
  const onPlaySubroute = PLAY_SUBROUTES.some((p) => location.pathname.startsWith(p));
  const onPlayRoute =
    location.pathname === '/play' ||
    (location.pathname.startsWith('/play/') && !onPlaySubroute);
  const usePlayChrome = (onPlayRoute || onPlaySubroute) && !challengeOpen;
  // The Spark bench is reached through the index, so keep the pill lit inside it.
  const playgroundsActive =
    location.pathname.startsWith(PLAYGROUNDS_PATH) ||
    location.pathname.startsWith(SPARK_PLAYGROUND_PATH);
  const papersActive = location.pathname.startsWith(PAPERS_PATH);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isNarrow) setNavOpen(false);
  }, [isNarrow]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = menuRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        setNavOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [navOpen]);

  const sectionLinks = showAdmin ? (
    <>
      <NavLink
        to={MAJORS_PATH}
        className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        Majors
      </NavLink>
      <NavLink
        to={MINORS_PATH}
        className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        Minors
      </NavLink>
      <NavLink
        to={PAPERS_PATH}
        className={`topnav-pill topnav-action${papersActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        Papers
      </NavLink>
      <NavLink
        to={PLAYGROUNDS_PATH}
        className={`topnav-pill topnav-action${playgroundsActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        Playgrounds
      </NavLink>
    </>
  ) : null;

  const accountLinks = (
    <>
      <NavLink
        to="/profile"
        className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        Profile
      </NavLink>
    </>
  );

  return (
    <div className={`app${challengeOpen ? ' app--challenge' : ''}${usePlayChrome ? ' app--play' : ''}`}>
      {challengeOpen ? (
        <ChallengeTopBar />
      ) : (
        <header className={`topbar${usePlayChrome ? ' topbar--play' : ''}`} ref={menuRef}>
          <div className="topbar-inner topbar-inner--play">
            <NavLink to="/" className="brand brand-link" end title="Home" onClick={() => setNavOpen(false)}>
              <BrandMark className="brand-mark" />
              <span className="brand-name">DevSetu</span>
              {!usePlayChrome && <span className="sub">v0.2</span>}
            </NavLink>

            <div className="topbar-trailing">
              {showNav && sectionLinks && (
                <nav className="topnav topnav--actions topnav--desktop" aria-label="Sections">
                  {sectionLinks}
                </nav>
              )}
              {showNav && (
                <nav className="topnav topnav--actions topnav--desktop" aria-label="Account">
                  {accountLinks}
                </nav>
              )}
              {showNav && (
                <button
                  type="button"
                  className="topnav-menu-btn"
                  aria-label={navOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={navOpen}
                  aria-controls={menuId}
                  onClick={() => setNavOpen((open) => !open)}
                >
                  <span className={`topnav-menu-icon${navOpen ? ' is-open' : ''}`} aria-hidden />
                </button>
              )}
            </div>
          </div>

          {showNav ? (
            <nav
              id={menuId}
              className={`topnav-drawer${navOpen ? ' is-open' : ''}`}
              aria-label="Sections"
              aria-hidden={!navOpen}
            >
              {sectionLinks ? <div className="topnav-drawer-group">{sectionLinks}</div> : null}
              <div className="topnav-drawer-group">{accountLinks}</div>
            </nav>
          ) : null}
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
