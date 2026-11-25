// Phase 5 panels for the report page: priority (with review/override),
// possible duplicates, and the technician recommendation.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { PRIORITIES, PRIORITY_LABEL, REVIEW_FLAG_LABEL, formatDateTime, locationText } from '../format';
import { Flag, PriorityBadge, StatusBadge } from '../ui';
import type {
  DuplicateFlagView,
  DuplicatesView,
  PriorityDetails,
  PriorityLevel,
  Recommendation,
  Report,
  ReportSummary,
} from '../types';

/* ---------------------------------------------------------------- priority */

export function PriorityPanel({ report, onChanged }: { report: Report; onChanged: () => void }) {
  const [data, setData] = useState<PriorityDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<PriorityLevel | 'AUTO'>('AUTO');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData((await api.get<PriorityDetails>(`/reports/${report.id}/priority`)).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [report.id]);

  useEffect(() => {
    void load();
  }, [load, report.priority, report.needsReview]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      setData((await api.post<PriorityDetails>(`/reports/${report.id}/priority`, body)).data);
      setEditing(false);
      setReason('');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  if (!data) return error ? <div className="card error-text">{error}</div> : null;

  const factors = data.priorityFactors ?? [];
  const overridden = data.priorityLocked && data.priority !== data.autoPriority;

  return (
    <div className={`card ${data.needsReview ? 'card-attention' : ''}`}>
      <div className="card-head">
        <h2>Priority</h2>
        <span className="head-badges">
          {data.needsReview && <Flag kind="warn">Needs review</Flag>}
          <PriorityBadge priority={data.priority} />
        </span>
      </div>
      <p className="muted">
        Automatic: <strong>{data.autoPriority ? `${data.autoPriority} ${PRIORITY_LABEL[data.autoPriority]}` : '—'}</strong>
        {data.priorityScore !== null && <> · score {data.priorityScore} / 100</>}
        {overridden && <> · set by a coordinator</>}
      </p>

      {data.reviewFlags.length > 0 && (
        <ul className="flag-list">
          {data.reviewFlags.map((f) => (
            <li key={f}>{REVIEW_FLAG_LABEL[f] ?? f}</li>
          ))}
        </ul>
      )}

      <details className="disclosure" open={data.needsReview}>
        <summary>How this priority was calculated</summary>
        <table className="table factors">
        <tbody>
          {factors.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="muted">{f.value}</td>
              <td className="num">
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${(f.points / f.max) * 100}%` }} />
                </span>
                {f.points} / {f.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        P1 Critical from 70 · P2 High from 50 · P3 Medium from 30 · P4 Low below 30. A safety
        hazard is never below P2.
      </p>
      </details>

      {!editing ? (
        <div className="btn-row">
          {data.needsReview && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void send({ action: 'confirm' })}>
              Confirm {data.priority}
            </button>
          )}
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setLevel(data.priority ?? 'AUTO');
              setEditing(true);
            }}
          >
            Change priority
          </button>
        </div>
      ) : (
        <div className="section">
          <label className="field">
            New priority
            <select value={level} onChange={(e) => setLevel(e.target.value as PriorityLevel | 'AUTO')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p} {PRIORITY_LABEL[p]}
                  {p === data.autoPriority ? ' (automatic)' : ''}
                </option>
              ))}
              {data.priorityLocked && <option value="AUTO">Back to automatic ({data.autoPriority})</option>}
            </select>
          </label>
          <label className="field">
            Reason (recorded)
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Example: affects the only working restroom on the floor" />
          </label>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void send({ action: 'adjust', priority: level === 'AUTO' ? null : level, reason })}
            >
              Save priority
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {data.priorityAdjustments.length > 0 && (
        <div className="section">
          <h2>Priority changes</h2>
          <ul className="item-list">
            {data.priorityAdjustments.map((a) => (
              <li key={a.id} className="assignment-row">
                <span className="item-main">
                  <strong>
                    {a.fromPriority ?? '—'} → {a.toPriority}
                  </strong>
                  <span className="decline-reason">“{a.reason}”</span>
                  <span className="muted">
                    {a.adjustedBy.fullName} · {formatDateTime(a.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.reviewedAt && data.reviewedBy && (
        <p className="muted small">
          Last reviewed by {data.reviewedBy.fullName} · {formatDateTime(data.reviewedAt)}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- duplicates */

function Summary({ r }: { r: ReportSummary }) {
  return (
    <span className="item-main">
      <Link to={`/reports/${r.id}`}>
        <strong>{r.category.name}</strong>
      </Link>
      <span className="muted">
        {locationText(r.location)} · {formatDateTime(r.createdAt)}
        {r.jobOrder && ` · ${r.jobOrder.jobOrderNo}`}
      </span>
      <span className="small">{r.description}</span>
    </span>
  );
}

type JobRef = NonNullable<ReportSummary['jobOrder']>;
const FINISHED = ['COMPLETED', 'CLOSED'];

// mirrors the server's default: the job that is further along continues
function progress(j: JobRef): number {
  if (FINISHED.includes(j.status)) return 5;
  if (j.status === 'IN_PROGRESS' || j.status === 'DELAYED') return 4;
  if (j.technician && j.assignmentStatus === 'ACCEPTED') return 3;
  if (j.technician && j.assignmentStatus === 'PENDING') return 2;
  return 1;
}

const jobText = (j: JobRef) =>
  `${j.jobOrderNo} · ${j.status.replace('_', ' ').toLowerCase()}` +
  (j.technician ? ` · ${j.technician.fullName}` : ' · no technician') +
  (j.assignmentStatus === 'ACCEPTED' ? ' (accepted)' : j.assignmentStatus === 'PENDING' ? ' (awaiting reply)' : '');

// both reports already have a job order: the coordinator picks the one that continues
function KeepJobChoice({
  mine,
  theirs,
  busy,
  onConfirm,
  onCancel,
}: {
  mine: JobRef;
  theirs: JobRef;
  busy: boolean;
  onConfirm: (keepId: string) => void;
  onCancel: () => void;
}) {
  const suggested = progress(mine) > progress(theirs) ? mine : theirs;
  const [keep, setKeep] = useState(suggested.id);
  const options = [theirs, mine];
  return (
    <div className="warn keep-choice">
      <strong>Both reports already have a job order.</strong> One problem needs one job order:
      choose the one that continues. The other is cancelled as merged (kept in the history), and
      its technician is told.
      {options.map((j) => {
        const finished = FINISHED.includes(j.status);
        const other = j === mine ? theirs : mine;
        const cannotDropOther = FINISHED.includes(other.status);
        return (
          <label key={j.id} className="keep-option">
            <input
              type="radio"
              name="keep"
              checked={keep === j.id}
              disabled={cannotDropOther}
              onChange={() => setKeep(j.id)}
            />
            Keep <strong>{jobText(j)}</strong>
            {j.id === suggested.id && <span className="flag flag-info">Suggested</span>}
            {finished && <span className="small muted"> already finished, cannot be cancelled</span>}
          </label>
        );
      })}
      <div className="btn-row">
        <button className="btn btn-primary btn-small" disabled={busy} onClick={() => onConfirm(keep)}>
          Confirm same problem
        </button>
        <button className="btn btn-small" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DuplicatesPanel({ report, onChanged }: { report: Report; onChanged: () => void }) {
  const [data, setData] = useState<DuplicatesView | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData((await api.get<DuplicatesView>(`/reports/${report.id}/duplicates`)).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [report.id]);

  useEffect(() => {
    void load();
  }, [load, report.duplicateOfId]);

  async function post(path: string, body?: object) {
    setBusy(true);
    setError(null);
    try {
      setData((await api.post<DuplicatesView>(path, body)).data);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      void load();
    }
    setBusy(false);
  }

  if (!data) return null;
  const myJob: JobRef | null =
    report.jobOrder && report.jobOrder.status !== 'CANCELLED'
      ? {
          id: report.jobOrder.id,
          jobOrderNo: report.jobOrder.jobOrderNo,
          status: report.jobOrder.status,
          assignmentStatus: report.jobOrder.assignmentStatus,
          technician: report.jobOrder.technician ?? null,
        }
      : null;
  const theirJob = (f: DuplicateFlagView & { candidate: ReportSummary }) =>
    f.candidate.jobOrder && f.candidate.jobOrder.status !== 'CANCELLED' ? f.candidate.jobOrder : null;
  const confirmFlag = (f: DuplicateFlagView & { candidate: ReportSummary }, keepJobOrderId?: string) =>
    post(`/reports/${report.id}/duplicates/${f.id}`, { decision: 'confirm', keepJobOrderId }).then(() =>
      setChoosing(null),
    );
  const open = data.possibleOriginals.filter((f) => f.status === 'OPEN');
  const decided = data.possibleOriginals.filter((f) => f.status !== 'OPEN');
  const copies = data.possibleCopies.filter((f) => f.status === 'OPEN');
  if (!data.duplicateOfId && open.length === 0 && decided.length === 0 && copies.length === 0 && data.linkedCopies.length === 0) {
    return null;
  }

  return (
    <div className={`card ${open.length ? 'card-attention' : ''}`}>
      <h2>Possible duplicates</h2>
      {open.length > 0 && (
        <p className="muted small">
          Suggestions only. Confirming links this report to the earlier one so it is handled there,
          and the reporter is told.
        </p>
      )}

      {data.duplicateOfId && (
        <div className="notice">
          This report is linked to another report of the same problem:{' '}
          <Link to={`/reports/${data.duplicateOfId}`}>open the main report</Link>. Unlinking
          reopens a merged job order without a technician.
          <div className="btn-row">
            <button className="btn btn-small" disabled={busy} onClick={() => void post(`/reports/${report.id}/unlink-duplicate`)}>
              Unlink
            </button>
          </div>
        </div>
      )}

      {open.length > 0 && (
        <ul className="item-list">
          {open.map((f) => (
            <li key={f.id} className="dup-row">
              <Summary r={f.candidate} />
              <span className="dup-side">
                <span className={`flag ${f.reasons.likely ? 'flag-danger' : 'flag-warn'}`}>
                  {f.reasons.likely ? 'Likely' : 'Possible'} · {f.score}
                </span>
                <span className="small muted">{f.reasons.reasons.join(' · ')}</span>
                {theirJob(f) && !myJob && (
                  <span className="small muted">Will follow {theirJob(f)!.jobOrderNo}</span>
                )}
                {myJob && !theirJob(f) && (
                  <span className="small muted">That report will follow {myJob.jobOrderNo}</span>
                )}
                <span className="btn-row">
                  <button
                    className="btn btn-small btn-primary"
                    disabled={busy || Boolean(data.duplicateOfId)}
                    onClick={() => {
                      const theirs = theirJob(f);
                      if (myJob && theirs) setChoosing(f.id);
                      else void confirmFlag(f);
                    }}
                  >
                    Same problem
                  </button>
                  <button className="btn btn-small" disabled={busy} onClick={() => void post(`/reports/${report.id}/duplicates/${f.id}`, { decision: 'dismiss' })}>
                    Not a duplicate
                  </button>
                </span>
              </span>
              {choosing === f.id && myJob && theirJob(f) && (
                <KeepJobChoice
                  mine={myJob}
                  theirs={theirJob(f)!}
                  busy={busy}
                  onConfirm={(keep) => void confirmFlag(f, keep)}
                  onCancel={() => setChoosing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {copies.length > 0 && (
        <>
          <h3 className="small-head">Later reports that may be this same problem</h3>
          <ul className="item-list">
            {copies.map((f) => (
              <li key={f.id} className="dup-row">
                <Summary r={f.report} />
                <span className="dup-side">
                  <span className="flag flag-warn">Score {f.score}</span>
                  <Link className="small" to={`/reports/${f.report.id}`}>Decide on that report</Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.linkedCopies.length > 0 && (
        <>
          <h3 className="small-head">Linked reports of this problem ({data.linkedCopies.length})</h3>
          <ul className="item-list">
            {data.linkedCopies.map((r) => (
              <li key={r.id} className="dup-row">
                <Summary r={r} />
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </>
      )}

      {decided.length > 0 && (
        <p className="muted small">
          Earlier decisions:{' '}
          {decided.map((f) => `${f.candidate.category.name} (${f.status === 'CONFIRMED' ? 'same problem' : 'not a duplicate'}${f.reviewedBy ? `, ${f.reviewedBy.fullName}` : ''})`).join('; ')}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- recommendation */

// shown in the "Review and assign" panel; the coordinator always decides
export function RecommendationBox({
  reportId,
  tradeUnitId,
  onRecommend,
}: {
  reportId: string;
  tradeUnitId: string;
  onRecommend: (technicianId: string) => void;
}) {
  const [data, setData] = useState<Recommendation | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Recommendation>(`/reports/${reportId}/recommendation`, { params: { tradeUnitId } })
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        if (r.data.recommended) onRecommend(r.data.recommended.id);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
    // onRecommend is stable enough for a one-time preselect per unit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, tradeUnitId]);

  if (!data) return null;
  if (!data.recommended) {
    return <p className="notice">No technician can be recommended for {data.tradeUnit.name} right now.</p>;
  }
  const others = data.candidates.filter((c) => c.id !== data.recommended!.id).slice(0, 3);
  return (
    <div className="recommend">
      <div>
        <span className="small muted">Recommended technician</span>
        <strong>{data.recommended.fullName}</strong>
        <span className="small">{data.recommended.reasons.join(' · ')}</span>
      </div>
      {others.length > 0 && (
        <span className="small muted">
          Next: {others.map((o) => `${o.fullName}${o.declinedThisJob ? ' (declined)' : ''}`).join(', ')}
        </span>
      )}
      <span className="small muted">Preselected below. Change it if you know better.</span>
    </div>
  );
}
