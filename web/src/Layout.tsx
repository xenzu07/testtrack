import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { useLiveStatus } from './socket';
import AccountMenu from './AccountMenu';
import Toasts from './Toasts';
import { NotificationBell, NotificationsProvider } from './notifications';

// 24px line icons, drawn with currentColor
const ICONS: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  queue: <><path d="M4 6h16M4 12h10M4 18h6" /><path d="m16 15 3 3-3 3" /></>,
  reports: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  jobs: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></>,
  forms: <><path d="M9 4h6v3H9z" /><path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>,
  technicians: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.8-1.7-5.1-4-5.8" /></>,
  analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  users: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>,
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function Brand() {
  return (
    <Link to="/overview" className="brand" aria-label="FACILITRACK home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6" />
        </svg>
      </span>
      <span className="brand-text">
        <span className="brand-name">FACILITRACK</span>
        <span className="brand-sub">CvSU Imus · GSO</span>
      </span>
    </Link>
  );
}

function LiveStatus() {
  const live = useLiveStatus();
  return (
    <span
      className="live"
      title={live ? 'Pages update automatically' : 'Not connected: refresh to see the latest changes'}
    >
      <span className={`dot ${live ? 'on' : ''}`} />
      <span className="live-text">{live ? 'Live updates on' : 'Offline'}</span>
    </span>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // close the phone drawer after navigating
  useEffect(() => setOpen(false), [pathname]);

  if (!user) return <Navigate to="/login" replace />;

  const link = (to: string, label: string, icon: string) => (
    <NavLink to={to}>
      <Icon name={icon} />
      {label}
    </NavLink>
  );

  return (
    <NotificationsProvider>
    <div className={`shell${open ? ' drawer-open' : ''}`}>
      <aside className="sidebar" aria-label="Main">
        <div className="sidebar-top">
          <Brand />
          <span className="sidebar-bell">
            <NotificationBell />
          </span>
        </div>
        <nav className="nav-group" aria-label="Work">
          <span className="nav-label">Work</span>
          {link('/overview', 'Overview', 'overview')}
          {link('/queue', 'Routing queue', 'queue')}
          {link('/reports', 'Reports', 'reports')}
          {link('/job-orders', 'Job orders', 'jobs')}
          {link('/forms', 'Forms', 'forms')}
        </nav>
        <nav className="nav-group" aria-label="Team">
          <span className="nav-label">Team</span>
          {link('/technicians', 'Technicians', 'technicians')}
          {link('/analytics', 'Analytics', 'analytics')}
          {user.role === 'ADMIN' && link('/users', 'Users', 'users')}
        </nav>
        <div className="sidebar-foot">
          <LiveStatus />
          <AccountMenu />
        </div>
      </aside>
      <div className="drawer-backdrop" onClick={() => setOpen(false)} />

      <div className="main">
        <header className="mobilebar">
          <button
            type="button"
            className="icon-btn icon-btn-plain"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Brand />
          <span className="mobilebar-bell">
            <NotificationBell />
          </span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
    </NotificationsProvider>
  );
}
