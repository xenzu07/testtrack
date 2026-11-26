import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from './api';
import { useAuth } from './auth';
import { useTheme } from './theme';

const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

// name + role in the top bar; opens change password / sign out actions
export default function AccountMenu() {
  const { user, logout, logoutEverywhere } = useAuth();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!user) return null;

  async function signOutEverywhere() {
    setOpen(false);
    if (!window.confirm('Sign out on every device and browser where you are signed in?')) return;
    try {
      await logoutEverywhere();
    } catch (e) {
      window.alert(errorMessage(e));
    }
  }

  return (
    <div className="account" ref={ref}>
      <button
        className="account-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {user.fullName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="account-text">
          <span className="account-name">{user.fullName}</span>
          <span className="account-role">{roleLabel(user.role)}</span>
        </span>
        <svg className="account-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m7 15 5-5 5 5" />
        </svg>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitemcheckbox" aria-checked={theme === 'dark'} onClick={toggle}>
            Dark mode
            <span className="muted small">{theme === 'dark' ? 'On' : 'Off'}</span>
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); setChanging(true); }}>
            Change password
          </button>
          <hr />
          <button role="menuitem" onClick={() => void signOutEverywhere()}>
            Sign out of all devices
          </button>
          <button role="menuitem" className="menu-danger" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { replaceToken } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // same rules the server enforces, checked early for a clear message
  const problem =
    next.length > 0 && next.length < 8
      ? 'At least 8 characters.'
      : next && !/[A-Za-z]/.test(next)
        ? 'Include at least one letter.'
        : next && !/\d/.test(next)
          ? 'Include at least one number.'
          : confirm && confirm !== next
            ? 'The new passwords do not match.'
            : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ accessToken: string }>('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      replaceToken(res.data.accessToken);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="cp-title">
        <h2 id="cp-title">Change password</h2>
        {done ? (
          <>
            <p className="notice">
              Password changed. You stay signed in here; other devices have been signed out.
            </p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <label className="field">
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoFocus
              />
            </label>
            <label className="field">
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label className="field">
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <p className="muted">At least 8 characters, with a letter and a number.</p>
            {(problem || error) && <p className="error-text">{problem ?? error}</p>}
            <div className="btn-row">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || !current || !next || next !== confirm || Boolean(problem)}
              >
                {busy ? 'Saving...' : 'Change password'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
