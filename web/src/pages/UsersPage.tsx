import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorBox } from '../ui';
import { userTypeLabel } from '../format';
import type { ManagedUser, ReportOptions, Role, TradeUnit } from '../types';

const ROLES: Role[] = ['REPORTER', 'TECHNICIAN', 'COORDINATOR', 'ADMIN'];
const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [units, setUnits] = useState<TradeUnit[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [editing, setEditing] = useState<ManagedUser | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, o] = await Promise.all([
        api.get<ManagedUser[]>('/users'),
        api.get<ReportOptions>('/reports/options'),
      ]);
      setUsers(u.data);
      const map = new Map<string, TradeUnit>();
      o.data.categories.forEach((c) => map.set(c.defaultTradeUnit.id, c.defaultTradeUnit));
      setUnits([...map.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!role || u.role === role) &&
        (!q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [users, search, role]);

  async function toggleActive(u: ManagedUser) {
    const verb = u.isActive ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${verb} ${u.fullName}?`)) return;
    try {
      await api.patch(`/users/${u.id}`, { isActive: !u.isActive });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (me?.role !== 'ADMIN') {
    return <ErrorBox message="Only administrators can manage user accounts." />;
  }

  return (
    <div>
      <div className="page-head">
        <h1>User accounts</h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          Add user
        </button>
      </div>

      {editing && (
        <UserForm
          key={editing === 'new' ? 'new' : editing.id}
          target={editing}
          units={units}
          isSelf={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      <div className="filters">
        <input
          style={{ width: 260 }}
          placeholder="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="card table-wrap">
        <table className="table table-responsive">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Type / Trade unit</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td data-label="Name">
                  <strong>{u.fullName}</strong>
                </td>
                <td data-label="Email">{u.email}</td>
                <td data-label="Role">{roleLabel(u.role)}</td>
                <td data-label="Type / Trade unit">
                  {u.tradeUnit?.name ?? (u.userType ? userTypeLabel(u.userType) : '—')}
                </td>
                <td data-label="Status">
                  {u.isActive ? (
                    <span className="flag flag-ok">Active</span>
                  ) : (
                    <span className="flag" style={{ background: 'var(--hover)', color: 'var(--muted)' }}>
                      Inactive
                    </span>
                  )}
                </td>
                <td>
                  <div className="btn-row" style={{ margin: 0 }}>
                    <button className="btn btn-small" onClick={() => setEditing(u)}>
                      Edit
                    </button>
                    {u.id !== me.id && (
                      <button className="btn btn-small" onClick={() => void toggleActive(u)}>
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserForm({
  target,
  units,
  isSelf,
  onClose,
  onSaved,
}: {
  target: ManagedUser | 'new';
  units: TradeUnit[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = target === 'new' ? null : target;
  const [fullName, setFullName] = useState(existing?.fullName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(existing?.role ?? 'REPORTER');
  const [userType, setUserType] = useState(existing?.userType ?? 'student');
  const [tradeUnitId, setTradeUnitId] = useState(existing?.tradeUnit?.id ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSave =
    fullName.trim().length >= 2 &&
    email.includes('@') &&
    (existing !== null || password.length >= 8) &&
    (role !== 'TECHNICIAN' || tradeUnitId !== '');

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        userType: role === 'REPORTER' ? userType : undefined,
        tradeUnitId: role === 'TECHNICIAN' ? tradeUnitId : undefined,
      };
      if (existing) await api.patch(`/users/${existing.id}`, body);
      else await api.post('/users', { ...body, password });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  async function resetPassword() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/users/${existing.id}/password`, { newPassword });
      setNewPassword('');
      setNotice('Password updated. Share it with the user securely.');
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <h2>{existing ? `Edit ${existing.fullName}` : 'Add user'}</h2>
      <div className="form-grid">
        <label className="field">
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label className="field">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {!existing && (
          <label className="field">
            Temporary password (min. 8 characters)
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          Role
          <select
            value={role}
            disabled={isSelf}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        {role === 'REPORTER' && (
          <label className="field">
            User type
            <select value={userType} onChange={(e) => setUserType(e.target.value)}>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="staff">Staff</option>
            </select>
          </label>
        )}
        {role === 'TECHNICIAN' && (
          <label className="field">
            Trade unit
            <select value={tradeUnitId} onChange={(e) => setTradeUnitId(e.target.value)}>
              <option value="">Select trade unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {existing && (
        <div className="section">
          <label className="field">
            Set a new password (min. 8 characters)
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <button
            className="btn"
            disabled={busy || newPassword.length < 8}
            onClick={() => void resetPassword()}
          >
            Set new password
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={busy || !canSave}
          onClick={() => void save()}
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
    </div>
  );
}