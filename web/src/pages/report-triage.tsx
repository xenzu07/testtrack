// Phase 5 panels for the report page: priority (with review/override),
// possible duplicates, and the technician recommendation.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { PRIORITIES, PRIORITY_LABEL, REVIEW_FLAG_LABEL, formatDay, formatDateTime, locationText } from '../format';
import { Flag, StatusBadge } from '../ui';
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

const PenIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

const priorityName = (p: PriorityLevel | null | undefined) => (p ? `${p} ${PRIORITY_LABEL[p]}` : 'Not scored');

// shown as a tab of the report's side card
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

  if (!data) return error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>;

  const factors = data.priorityFactors ?? [];
  const overridden = data.priorityLocked && data.priority !== data.autoPriority;
  // the server never lets a safety hazard drop below P2
  const blocked = (p: PriorityLevel) => report.safetyHazard === true && (p === 'P3' || p === 'P4');
  const unchanged = level === 'AUTO' ? !data.priorityLocked : level === data.priority;
  // a report linked to an earlier report of the same problem follows that report
  const linked = Boolean(report.duplicateOfId);
  const startEdit = (to: PriorityLevel | 'AUTO') => {
    setLevel(to);
    setReason('');
    setEditing(true);
  };

  return (
    <>
      <div className="card-head">
        <span className="muted small">
          {overridden ? 'Set by a coordinator' : 'Calculated by the system from the report'}
        </span>
        <span className="head-badges">
          {data.needsReview && !linked && <Flag kind="warn">Needs review</Flag>}
          <span className={`badge p-${data.priority ?? 'none'}`}>
            {priorityName(data.priority)}
            {!overridden && data.priorityScore !== null && ` · score ${data.priorityScore}`}
          </span>
        </span>
      </div>

      {data.reviewFlags.length > 0 && (
        <ul className="flag-list">
          {data.reviewFlags.map((f) => (
            <li key={f}>{REVIEW_FLAG_LABEL[f] ?? f}</li>
          ))}
        </ul>
      )}

      <details className="disclosure" open>
        <summary>How this priority was calculated</summary>
        <table className="table factors">
          <tbody>
            {factors.map((f) => (
              <tr key={f.key}>
                <td>
                  {f.label}
                  <div className="cell-sub">{f.value}</div>
                </td>
                <td>
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${(f.points / f.max) * 100}%` }} />
                  </span>
                </td>
                <td className="num">
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

      {linked && (
        <p className="locked-row">
          {/* one span: the row is a flex container, which would split the sentence into columns */}
          <span>
            This report is linked to{' '}
            <Link to={`/reports/${report.duplicateOfId}`}>an earlier report</Link> of the same problem.
            Change the priority there.
          </span>
        </p>
      )}

      {!linked && !editing && !overridden && (
        <div className="pri-change">
          <div>
            <strong>{data.needsReview ? 'Is this priority right?' : 'Disagree with this priority?'}</strong>
            <span className="muted small">
              {data.needsReview ? 'Confirm it, or override it with a reason.' : 'Override it with a reason.'}
            </span>
          </div>
          {data.needsReview && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send({ action: 'confirm' })}>
              Confirm {data.priority}
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => startEdit(data.priority ?? 'AUTO')}>
            <PenIcon />
            Change priority
          </button>
        </div>
      )}

      {!linked && !editing && overridden && (
        <div className="pri-change">
          <div>
            <strong>Changed to {priorityName(data.priority)} by a coordinator</strong>
            <span className="muted small">
              The system calculated {priorityName(data.autoPriority)}
              {data.priorityScore !== null && ` (score ${data.priorityScore})`}.
            </span>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={() => startEdit(data.priority ?? 'AUTO')}>
            <PenIcon />
            Change
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => startEdit('AUTO')}>
            Revert to calculated
          </button>
        </div>
      )}

      {!linked && editing && (
        <div className="pri-edit">
          <div className="pri-edit-head">
            <strong>{level === 'AUTO' ? 'Revert to calculated' : 'Set priority'}</strong>
            <span className="muted small">Currently {priorityName(data.priority)}</span>
          </div>
          {level === 'AUTO' ? (
            <p className="muted small pri-note">
              The priority goes back to the calculated {priorityName(data.autoPriority)} and follows the
              report again.
            </p>
          ) : (
            <>
              <div className="seg-grid" role="radiogroup" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={level === p}
                    disabled={blocked(p)}
                    className={`seg${blocked(p) ? ' is-off' : level === p ? ' is-on' : ''}`}
                    onClick={() => setLevel(p)}
                  >
                    <span className={`seg-dot d-${p}`} />
                    <strong>{p}</strong>
                    <span>{PRIORITY_LABEL[p]}</span>
                  </button>
                ))}
              </div>
              {report.safetyHazard === true && (
                <p className="muted small pri-note">
                  P3 and P4 are unavailable because this report is a safety hazard.
                </p>
              )}
            </>
          )}
          <label className="field-label" htmlFor="pri-reason">
            Reason (recorded)
          </label>
          <textarea
            id="pri-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={level === 'AUTO' ? 'Why the calculated priority is right after all' : 'Why the calculated priority is wrong'}
          />
          <div className="pri-edit-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || unchanged || reason.trim().length < 5}
              onClick={() => void send({ action: 'adjust', priority: level === 'AUTO' ? null : level, reason })}
            >
              {level === 'AUTO' ? 'Revert priority' : 'Save priority'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(false)}>
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
        <p className="muted small pri-reviewed">
          Last reviewed by {data.reviewedBy.fullName} · {formatDateTime(data.reviewedAt)}
        </p>
      )}
    </>
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

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5L20 7" />
  </svg>
);
const CrossIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

// shown as a tab of the report's side card; reports its open suggestions
// so the tab can show a count
export function DuplicatesPanel({
  report,
  onChanged,
  onOpenCount,
  onHasContent,
}: {
  report: Report;
  onChanged: () => void;
  onOpenCount?: (n: number) => void;
  onHasContent?: (has: boolean) => void;
}) {
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

  // a linked report is decided on through its main report: suggestions about
  // it are moved there, so none are shown (or counted) here
  const openCount =
    data && !data.duplicateOfId ? data.possibleOriginals.filter((f) => f.status === 'OPEN').length : 0;
  const hasContent = Boolean(
    data &&
      (data.duplicateOfId ||
        data.possibleOriginals.length > 0 ||
        (!data.duplicateOfId && data.possibleCopies.some((f) => f.status === 'OPEN')) ||
        data.linkedCopies.length > 0),
  );
  // reported once the suggestions have loaded, so callers can wait for it
  const loaded = data !== null;
  useEffect(() => {
    if (loaded) onOpenCount?.(openCount);
  }, [onOpenCount, openCount, loaded]);
  useEffect(() => {
    onHasContent?.(hasContent);
  }, [onHasContent, hasContent]);

  if (!data) return error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>;
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
  const open = data.duplicateOfId ? [] : data.possibleOriginals.filter((f) => f.status === 'OPEN');
  const decided = data.possibleOriginals.filter((f) => f.status !== 'OPEN');
  const copies = data.duplicateOfId ? [] : data.possibleCopies.filter((f) => f.status === 'OPEN');
  const nothing = !hasContent;

  return (
    <>
      {nothing && <p className="muted">No other report looks like the same problem.</p>}
      {open.length > 0 && (
        <p className="muted" style={{ marginTop: 0 }}>
          Detected by the system. Same problem links this report to the earlier one and closes it
          right away; no job order is created for it.
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

      {open.map((f) => (
        <div key={f.id} className="dup-card">
          <div className="dup-top">
            <Link to={`/reports/${f.candidate.id}`}>
              <strong>
                {f.candidate.category.name} · {f.candidate.location.room || locationText(f.candidate.location)}
              </strong>
            </Link>
            <span className={`flag ${f.reasons.likely ? 'flag-danger' : 'flag-warn'}`}>
              {f.reasons.likely ? 'Likely' : 'Possible'} · {f.score}
            </span>
          </div>
          <span className="muted small">
            {[
              `Reported ${formatDay(f.candidate.createdAt)}${f.candidate.reporter ? ` by ${f.candidate.reporter.fullName}` : ''}`,
              f.candidate.jobOrder?.jobOrderNo,
              f.reasons.reasons.join(', ').toLowerCase(),
              daysApart(f.candidate.createdAt, report.createdAt),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {theirJob(f) && !myJob && <span className="small muted">Will follow {theirJob(f)!.jobOrderNo}</span>}
          {myJob && !theirJob(f) && <span className="small muted">That report will follow {myJob.jobOrderNo}</span>}
          <p className="dup-q">Is this the same problem?</p>
          <div className="dup-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                const theirs = theirJob(f);
                if (myJob && theirs) setChoosing(f.id);
                else void confirmFlag(f);
              }}
            >
              <CheckIcon />
              Same problem
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void post(`/reports/${report.id}/duplicates/${f.id}`, { decision: 'dismiss' })}
            >
              <CrossIcon />
              Not a duplicate
            </button>
          </div>
          {choosing === f.id && myJob && theirJob(f) && (
            <KeepJobChoice
              mine={myJob}
              theirs={theirJob(f)!}
              busy={busy}
              onConfirm={(keep) => void confirmFlag(f, keep)}
              onCancel={() => setChoosing(null)}
            />
          )}
        </div>
      ))}

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
    </>
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
    const allFull = data.candidates.length > 0 && data.candidates.every((c) => c.atLimit || c.declinedThisJob);
    return (
      <p className="notice">
        No technician can be recommended for {data.tradeUnit.name} right now
        {allFull ? ': everyone qualified is at the active-job limit or declined this job.' : '.'}
      </p>
    );
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
          Next: {others.map((o) => `${o.fullName}${o.declinedThisJob ? ' (declined)' : o.atLimit ? ' (full)' : ''}`).join(', ')}
        </span>
      )}
      <span className="small muted">Preselected below. Change it if you know better.</span>
    </div>
  );
}

// "1 day apart", "3 days apart" or "same day"
function daysApart(a: string, b: string): string {
  const d = Math.round(Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  return d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'} apart`;
}
