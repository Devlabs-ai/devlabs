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

  const showNav = authMode === 'interviewer' && playState !== 'active';

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <NavLink to="/play" className="brand brand-link">
            <span className="logo-dot" />
            Devlabs
            <span className="sub">v0.1</span>
          </NavLink>

          {showNav && (
            <nav className="topnav">
              <NavLink
                to="/play"
                className={({ isActive }) => `topnav-pill${isActive ? ' active' : ''}`}
              >
                Play
              </NavLink>
              <NavLink
                to="/authoring"
                className={({ isActive }) => `topnav-pill${isActive ? ' active' : ''}`}
              >
                Authoring
              </NavLink>
            </nav>
          )}

          <div className="right">
            {playState === 'active' && activeSession && (
              <SessionController
                session={activeSession}
                onEnd={onEnd}
                ending={ending}
              />
            )}
            {authMode === 'interviewer' && (
              <div className="topbar-user">
                {currentUser && (
                  <div className="topbar-user-info">
                    <span className="topbar-user-email" title={currentUser.email}>
                      {currentUser.email}
                    </span>
                    <span className={`topbar-role-badge topbar-role-${currentUser.role}`}>
                      {currentUser.role}
                    </span>
                  </div>
                )}
                <button type="button" className="ghost" onClick={onLogout}>
                  Sign out
                </button>
              </div>
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
