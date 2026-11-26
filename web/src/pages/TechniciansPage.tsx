import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { formatDateTime } from '../format';
import { useRealtime } from '../socket';
import { ErrorBox, RefreshButton, Flag } from '../ui';
import type { Technician, TechnicianSurveyView } from '../types';

// survey roles as small chips with their score
export function RoleChips({ technician }: { technician: Technician }) {
  if (!technician.surveyCompletedAt) return <span className="muted">Survey not taken yet</span>;
  if (technician.roles.length === 0) return <span className="muted">No survey roles</span>;
  return (
    <span className="chips">
      {technician.roles.map((r) => (
        <span key={r.tradeUnit.id} className="chip" title={`Survey score ${r.score} / 100`}>
          {r.tradeUnit.name} <b>{r.score}</b>
        </span>
      ))}
    </span>
  );
}

// stacked bar: assigned / in progress / delayed, out of the active-job limit
export function WorkloadBar({ technician, max }: { technician: Technician; max: number }) {
  const w = technician.workload;
  const pct = (n: number) => `${(n / Math.max(1, max)) * 100}%`;
  const title =
    `${w.assigned} assigned, ${w.inProgress} in progress, ${w.delayed} delayed` +
    (w.awaitingVerification ? `, ${w.awaitingVerification} awaiting verification` : '');
  return (
    <span className="workload" title={title}>
      <span className="workload-track" aria-hidden="true">
        <span className="wl wl-assigned" style={{ width: pct(w.assigned) }} />
        <span className="wl wl-progress" style={{ width: pct(w.inProgress) }} />
        <span className="wl wl-delayed" style={{ width: pct(w.delayed) }} />
      </span>
      <span className="workload-count">
        {w.active} of {w.limit} active
        <span className="sr-only">: {title}</span>
      </span>
    </span>
  );
}

// colour key for WorkloadBar
export function WorkloadLegend() {
  return (
    <p className="legend">
      <span><i style={{ background: 'var(--st-assigned)' }} />Assigned</span>
      <span><i style={{ background: 'var(--st-progress)' }} />In progress</span>
      <span><i style={{ background: 'var(--st-delayed)' }} />Delayed</span>
    </p>
  );
}

export default function TechniciansPage() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [search, setSearch] = useState('');
  const [unitId, setUnitId] = useState('');
  const [selected, setSelected] = useState<Technician | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<Technician[]>('/job-orders/technicians');
      setTechnicians(res.data);
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(() => {
    void load();
  });

  const units = useMemo(() => {
    const m = new Map<string, string>();
    technicians.forEach((t) => t.tradeUnit && m.set(t.tradeUnit.id, t.tradeUnit.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [technicians]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return technicians
      .filter(
        (t) =>
          // a technician belongs to a unit by assignment or by survey role
          (!unitId ||
            t.tradeUnit?.id === unitId ||
            t.roles.some((r) => r.tradeUnit.id === unitId)) &&
          (!q || t.fullName.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          (a.tradeUnit?.name ?? '').localeCompare(b.tradeUnit?.name ?? '') ||
          b.workload.active - a.workload.active ||
          a.fullName.localeCompare(b.fullName),
      );
  }, [technicians, search, unitId]);

  // bars are scaled to the active-job limit, so a full bar means the technician is full
  const maxActive = Math.max(1, ...technicians.map((t) => Math.max(t.workload.limit, t.workload.active)));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Technicians</h1>
          <p className="muted subtitle">
            Select a technician to see their skills survey answers.
          </p>
        </div>
        <RefreshButton onClick={() => void load()} loading={loading} />
      </div>

      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Search technician"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">All trade units</option>
          {units.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <WorkloadLegend />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {!error && (
        <div className="card table-wrap">
          <table className="table table-responsive table-clickable">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Survey roles</th>
                <th>Current workload</th>
                <th className="num">To verify</th>
                <th className="num">Closed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} onClick={() => setSelected(t)}>
                  <td data-label="Technician">
                    <strong>{t.fullName}</strong>
                    <div className="cell-sub">{t.tradeUnit?.name ?? 'No trade unit'}</div>
                  </td>
                  <td data-label="Survey roles">
                    <RoleChips technician={t} />
                  </td>
                  <td data-label="Workload">
                    <WorkloadBar technician={t} max={maxActive} />
                  </td>
                  <td data-label="To verify" className="num">{t.workload.awaitingVerification}</td>
                  <td data-label="Closed" className="num">{t.workload.closed}</td>
                  <td data-label="" className="num">
                    <Link className="cell-link" to={`/analytics/technicians/${t.id}`} onClick={(e) => e.stopPropagation()}>
                      Performance
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center">
                    No technicians match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <SurveyDialog technician={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// a technician's latest survey answers and how they were scored
function SurveyDialog({ technician, onClose }: { technician: Technician; onClose: () => void }) {
  const [data, setData] = useState<TechnicianSurveyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<TechnicianSurveyView>(`/technicians/${technician.id}/survey`)
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [technician.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sorted = [...(data?.survey?.units ?? [])].sort((a, b) => b.score - a.score);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal-wide card" role="dialog" aria-modal="true" aria-labelledby="sv-title">
        <div className="card-head">
          <h2 id="sv-title">{technician.fullName}</h2>
          <button className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Assigned trade unit: <strong>{technician.tradeUnit?.name ?? 'none'}</strong>
          {data?.survey && <> · survey submitted {formatDateTime(data.survey.submittedAt)}</>}
        </p>

        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="muted">Loading...</p>}

        {data && !data.survey && (
          <p className="notice">
            This technician has not completed the skills survey yet. They are asked to fill it
            in the next time they sign in to the mobile app. Until then they only match jobs for
            their assigned trade unit.
          </p>
        )}

        {data?.primaryNotQualified && (
          <p className="warn">
            Their survey answers do not reach the role threshold for their assigned trade unit (
            {technician.tradeUnit?.name}). They still receive those jobs; you may want to confirm
            their skills.
          </p>
        )}

        {data?.survey && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Trade</th>
                  <th>Role</th>
                  <th className="num">Score</th>
                  <th>Skill</th>
                  <th>Experience</th>
                  <th>Tasks they can do</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr key={u.tradeUnitId} className={u.proficiency === 'None' ? 'row-muted' : ''}>
                    <td>
                      <strong>{u.name}</strong>
                    </td>
                    <td>
                      {u.qualified ? <Flag kind="info">Qualified</Flag> : <span className="muted">—</span>}
                    </td>
                    <td className="num">{u.score}</td>
                    <td>
                      {u.proficiency}
                      {u.certified && <div className="cell-sub">Certified / trained</div>}
                    </td>
                    <td>{u.experience ?? '—'}</td>
                    <td className="wrap">
                      {u.taskCount === 0
                        ? '—'
                        : u.tasks.length === 0
                          ? `0 of ${u.taskCount}`
                          : `${u.tasks.length} of ${u.taskCount}: ${u.tasks.join(', ')}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          A role needs at least Intermediate skill and a score of 50 or more. Technicians with a
          role can be assigned that trade unit's jobs in addition to their assigned unit.
        </p>
      </div>
    </div>
  );
}
