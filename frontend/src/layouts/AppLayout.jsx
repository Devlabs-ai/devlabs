import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import SessionController from '../components/SessionController.jsx';
import { useAppState } from '../context/AppStateContext.jsx';

function UserDrawer({ open, onClose, currentUser, onLogout }) {
  const drawerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isAdmin = currentUser?.role === 'admin';
  const initials = currentUser?.name
    ? currentUser.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : currentUser?.email?.[0]?.toUpperCase() || '?';

  return (
    <>
      {open && <div className="drawer-backdrop" aria-hidden onClick={onClose} />}
      <div className={`user-drawer${open ? ' open' : ''}`} ref={drawerRef} role="dialog" aria-label="User menu">
        <div className="user-drawer-profile">
          <div className="user-drawer-avatar">{initials}</div>
          <div className="user-drawer-info">
            <span className="user-drawer-name">{currentUser?.name || 'User'}</span>
            <span className="user-drawer-email">{currentUser?.email}</span>
            <span className={`user-drawer-role-badge role-${currentUser?.role}`}>
              {currentUser?.role}
            </span>
          </div>
        </div>

        <div className="user-drawer-divider" />

        <nav className="user-drawer-nav">
          <button type="button" className="user-drawer-item">
            <span className="user-drawer-item-icon">⊙</span>
            Profile
          </button>

          {isAdmin && (
            <button type="button" className="user-drawer-item">
              <span className="user-drawer-item-icon">◈</span>
              Billing
            </button>
          )}
        </nav>

        <div className="user-drawer-divider" />

        <button
          type="button"
          className="user-drawer-item user-drawer-logout"
          onClick={() => { onClose(); onLogout(); }}
        >
          <span className="user-drawer-item-icon">→</span>
          Sign out
        </button>
      </div>
    </>
  );
}

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

  const [drawerOpen, setDrawerOpen] = useState(false);
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
              <button
                type="button"
                className="avatar-btn"
                aria-label="Open user menu"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((o) => !o)}
              >
                {currentUser?.name
                  ? currentUser.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
                  : currentUser?.email?.[0]?.toUpperCase() || '?'}
              </button>
            )}
            {authMode === 'candidate' && (
              <span className="badge brand"><span className="dot" /> {candidateInvite?.name}</span>
            )}
          </div>
        </div>
      </div>

      <UserDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        currentUser={currentUser}
        onLogout={onLogout}
      />

      <div className="app-body">
        <Outlet />
      </div>
    </div>
  );
}
