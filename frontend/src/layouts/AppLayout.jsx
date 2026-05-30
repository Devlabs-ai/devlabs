import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import SessionController from '../components/SessionController.jsx';
import { useAppState } from '../context/AppStateContext.jsx';

export default function AppLayout() {
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

  const isAdmin = currentUser?.role === 'admin';
  const showNav = authMode === 'interviewer' && playState !== 'active';

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

                <span className="topnav-sep" />

                <button type="button" className="topnav-pill topnav-action">Profile</button>
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

      <div className="app-body">
        <Outlet />
      </div>
    </div>
  );
}
