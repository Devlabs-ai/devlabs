import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import SessionController from '../components/SessionController';
import { useAppState } from '../context/AppStateContext';

export default function AppLayout(): React.JSX.Element {
  const {
    authMode,
    currentUser,
    candidateInvite,
    playState,
    activeSession,
    ending,
    onEnd,
    onLogout,
  } = useAppState();

  const location = useLocation();
  const reviewSandboxOpen = /^\/review\/[^/]+\/sandbox/.test(location.pathname);
  const isAdmin = currentUser?.role === 'admin';
  const showNav = authMode === 'interviewer' && playState !== 'active' && !reviewSandboxOpen;

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner topbar-inner--split">
          <NavLink to="/play" className="brand brand-link">
            <span className="logo-dot" />
            Devlabs
            <span className="sub">v0.1</span>
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
                <NavLink to="/play"      className={({ isActive }) => `topnav-pill${isActive ? ' active' : ''}`}>Play</NavLink>
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
                {import.meta.env.DEV && (
                  <NavLink
                    to="/dev/db"
                    className={({ isActive }) => `topnav-pill topnav-action${isActive ? ' active' : ''}`}
                  >
                    DB
                  </NavLink>
                )}
                {isAdmin && (
                  <button type="button" className="topnav-pill topnav-action">Billing</button>
                )}
                <button type="button" className="topnav-pill topnav-action topnav-signout" onClick={onLogout}>
                  Sign out
                </button>
              </nav>
            )}

            {authMode === 'candidate' && (
              <span className="badge brand"><span className="dot" /> {candidateInvite?.name}</span>
            )}
          </div>
        </div>
      </div>

      <div className={`app-body${reviewSandboxOpen ? ' app-body--review-sandbox' : ''}`}>
        <Outlet />
      </div>
    </div>
  );
}
