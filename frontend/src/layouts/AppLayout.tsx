import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { useAppState } from '../context/AppStateContext';
import { isAdminUser } from '../services/authApi';
import { PlayChromeProvider } from '../context/PlayChromeContext';
import { PLAYGROUNDS_PATH, SPARK_PLAYGROUND_PATH } from '../constants/playgrounds';
import { MAJORS_PATH } from '../constants/projects';
import { MINORS_PATH } from '../constants/minors';
import { PRICING_PATH } from '../constants/pricing';
import { MONTHLY_PAPER_PATH } from '../constants/monthlyPaper';
import { LEADERBOARD_PATH } from '../constants/leaderboard';
import { WHITEBOARD_PATH } from '../constants/whiteboard';
import { useIsNarrowUi } from '../hooks/useMediaQuery';
import NavIcon from '../components/NavIcons';
import PlatformFooter from '../components/PlatformFooter';

const PAPERS_PATH = '/track/papers';

const PLATFORM_FOOTER_ENABLED = false;

/** Viewport-filling workspaces that manage their own scrolling. */
const FOOTERLESS_PREFIXES = ['/track/quiz/', SPARK_PLAYGROUND_PATH, '/dev/db'];
const MAJOR_MODULE_ROUTE = new RegExp(`^${MAJORS_PATH}/[^/]+/[^/]+`);
/** Play catalog routes that read like documents rather than the fixed catalog grid. */
const PLAY_DOCUMENT_ROUTE = /\/(read\/[^/]+|intro|leaderboard)\/?$/;

/** Play routes that bring their own page chrome instead of the catalog's. */
const PLAY_SUBROUTES = [
  PRICING_PATH,
  MONTHLY_PAPER_PATH,
  LEADERBOARD_PATH,
  '/track/quiz/',
  PAPERS_PATH,
  '/track/quests',
  PLAYGROUNDS_PATH,
  MAJORS_PATH,
  MINORS_PATH,
  WHITEBOARD_PATH,
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
    onRequestLogin,
    onLogout,
  } = useAppState();

  const location = useLocation();
  const isNarrow = useIsNarrowUi();
  const [navOpen, setNavOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const challengeOpen = playState === 'active' && Boolean(activeSession);
  const signedIn = authMode === 'interviewer';
  const showNav = authMode !== 'resolving' && playState !== 'active';
  const showAdmin = Boolean(currentUser?.admin) || isAdminUser(currentUser);
  const onPlaySubroute = PLAY_SUBROUTES.some((p) => location.pathname.startsWith(p));
  const onPlayRoute =
    location.pathname === '/track' ||
    (location.pathname.startsWith('/track/') && !onPlaySubroute);
  const usePlayChrome = !challengeOpen;
  // The Spark bench is reached through the index, so keep the pill lit inside it.
  const playgroundsActive =
    location.pathname.startsWith(PLAYGROUNDS_PATH) ||
    location.pathname.startsWith(SPARK_PLAYGROUND_PATH);
  const papersActive = location.pathname.startsWith(PAPERS_PATH);
  const showFooter =
    PLATFORM_FOOTER_ENABLED &&
    authMode !== 'resolving' &&
    !challengeOpen &&
    !(onPlayRoute && !PLAY_DOCUMENT_ROUTE.test(location.pathname)) &&
    !MAJOR_MODULE_ROUTE.test(location.pathname) &&
    !FOOTERLESS_PREFIXES.some((p) => location.pathname.startsWith(p));
  const profileSection =
    location.pathname === '/profile' ? new URLSearchParams(location.search).get('section') || 'overview' : null;

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

  const sectionLinks = (
    <>
      <NavLink
        to="/track"
        className={`topnav-pill topnav-action${onPlayRoute ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        <NavIcon name="track" />
        <span>Track</span>
      </NavLink>
      <NavLink
        to={MAJORS_PATH}
        className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        <NavIcon name="majors" />
        <span>Majors</span>
      </NavLink>
      <NavLink
        to={MINORS_PATH}
        className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        <NavIcon name="minors" />
        <span>Minors</span>
      </NavLink>
      {showAdmin && (
        <>
          <NavLink
            to={PAPERS_PATH}
            className={`topnav-pill topnav-action${papersActive ? ' active' : ''}`}
            onClick={() => setNavOpen(false)}
          >
            <NavIcon name="papers" />
            <span>Papers</span>
          </NavLink>
          <NavLink
            to={PLAYGROUNDS_PATH}
            className={`topnav-pill topnav-action${playgroundsActive ? ' active' : ''}`}
            onClick={() => setNavOpen(false)}
          >
            <NavIcon name="playgrounds" />
            <span>Playgrounds</span>
          </NavLink>
        </>
      )}
      <NavLink
        to={LEADERBOARD_PATH}
        className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        <NavIcon name="leaderboard" />
        <span>Leaderboard</span>
      </NavLink>
      <NavLink
        to={PRICING_PATH}
        className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
        onClick={() => setNavOpen(false)}
      >
        <NavIcon name="pricing" />
        <span>Pricing</span>
      </NavLink>
    </>
  );

  const accountLinks = signedIn ? (
    <NavLink
      to="/profile"
      className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
      onClick={() => setNavOpen(false)}
    >
      <NavIcon name="profile" />
      <span>Profile</span>
    </NavLink>
  ) : (
    <button
      type="button"
      className="topnav-pill topnav-action"
      onClick={() => {
        setNavOpen(false);
        onRequestLogin();
      }}
    >
      <NavIcon name="signin" />
      <span>Sign in</span>
    </button>
  );

  const drawerAccountLinks = signedIn ? (
    <>
      {([
        ['overview', 'Profile', 'profile'],
        ['subscriptions', 'Subscriptions', 'subscriptions'],
        ['contact', 'Contact', 'contact'],
      ] as const).map(([section, label, icon]) => (
        <Link
          key={section}
          to={section === 'overview' ? '/profile' : `/profile?section=${section}`}
          className={`topnav-pill topnav-action${profileSection === section ? ' active' : ''}`}
          onClick={() => setNavOpen(false)}
        >
          <NavIcon name={icon} />
          <span>{label}</span>
        </Link>
      ))}
      {showAdmin && (
        <NavLink
          to="/admin"
          className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
          onClick={() => setNavOpen(false)}
        >
          <NavIcon name="admin" />
          <span>Admin</span>
        </NavLink>
      )}
      <button
        type="button"
        className="topnav-pill topnav-action topnav-action--signout"
        onClick={() => {
          setNavOpen(false);
          onLogout();
        }}
      >
        <NavIcon name="signout" />
        <span>Sign out</span>
      </button>
    </>
  ) : (
    accountLinks
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
            <div
              className={`topnav-scrim${navOpen ? ' is-open' : ''}`}
              aria-hidden
              onClick={() => setNavOpen(false)}
            />
          ) : null}
          {showNav ? (
            <nav
              id={menuId}
              className={`topnav-drawer${navOpen ? ' is-open' : ''}`}
              aria-label="Sections"
              aria-hidden={!navOpen}
            >
              <p className="topnav-drawer-heading">Menu</p>
              {sectionLinks ? <div className="topnav-drawer-group">{sectionLinks}</div> : null}
              <div className="topnav-drawer-group">{drawerAccountLinks}</div>
            </nav>
          ) : null}
        </header>
      )}

      <div
        className={`app-body${challengeOpen ? ' app-body--challenge' : ''}${showFooter ? ' app-body--with-footer' : ''}`}
      >
        <Outlet />
        {showFooter && <PlatformFooter signedIn={signedIn} onRequestLogin={onRequestLogin} />}
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
