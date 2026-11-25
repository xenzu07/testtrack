import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, mediaUrl } from '../api';
import {
  formatDate,
  formatDateTime,
  isOverdue,
  isProgressUpdate,
  locationText,
  statusLabel,
} from '../format';
import {
  AssignmentFlag,
  ErrorBox,
  Flag,
  FormStatusBadge,
  PriorityBadge,
  StatusBadge,
  StatusStepper,
  UrgencyBadge,
} from '../ui';
import type {
  AssignmentStatus,
  JobOrder,
  Report,
  ReportOptions,
  Technician,
  TradeUnit,
} from '../types';
import { useRealtime } from '../socket';
import { DuplicatesPanel, PriorityPanel, RecommendationBox } from './report-triage';

// timeline dot colour per status (matches the status labels)
const STATUS_DOT: Record<string, string> = {
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'review',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'progress',
  DELAYED: 'delayed',
  COMPLETED: 'completed',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
};

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [job, setJob] = useState<JobOrder | null>(null);
  const [tradeUnits, setTradeUnits] = useState<TradeUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, o] = await Promise.all([
        api.get<Report>(`/reports/${id}`),
        api.get<ReportOptions>('/reports/options'),
      ]);
      setReport(r.data);

      // every trade unit owns at least one category, so derive the list from it
      const units = new Map<string, TradeUnit>();
      o.data.categories.forEach((c) =>
        units.set(c.defaultTradeUnit.id, c.defaultTradeUnit),
      );
      setTradeUnits(
        [...units.values()].sort((a, b) => a.name.localeCompare(b.name)),
      );

      if (r.data.jobOrder) {
        const j = await api.get<JobOrder>(`/job-orders/${r.data.jobOrder.id}`);
        setJob(j.data);
      } else {
        setJob(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime((e) => {
    if (e.reportId === id) void load();
  });

  if (loading) return <p className="muted">Loading...</p>;
  if (error || !report) {
    return <ErrorBox message={error ?? 'Report not found'} onRetry={() => void load()} />;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/reports" className="back">← Reports</Link>
          <h1>{report.category.name}</h1>
          <p className="muted subtitle">
            {locationText(report.location)}
            {report.jobOrder ? ` · ${report.jobOrder.jobOrderNo}` : ''}
          </p>
        </div>
        <div className="head-badges">
          <StatusBadge status={report.status} />
          <PriorityBadge priority={report.priority} />
          {job && isOverdue(job) && <Flag kind="danger">Overdue</Flag>}
        </div>
      </div>

      <div className="card card-tight">
        <StatusStepper status={report.status} />
      </div>

      <div className="grid-2">
        <div>
          <div className="card">
            {report.photos.map((p) =>
              mediaUrl(p.storageUrl) ? (
                <img
                  key={p.id}
                  className="photo"
                  src={mediaUrl(p.storageUrl)}
                  alt="Reported issue"
                />
              ) : (
                <p key={p.id} className="muted">
                  Photo unavailable right now. Reload the page to try again.
                </p>
              ),
            )}
            <p className="description">{report.description}</p>
            <dl className="kv">
              <dt>Location</dt>
              <dd>{locationText(report.location)}</dd>
              <dt>Reporter urgency</dt>
              <dd>
                <UrgencyBadge urgency={report.urgency} />
              </dd>
              <dt>Reported by</dt>
              <dd>
                {report.reporter.fullName}
                {report.reporter.userType ? ` (${report.reporter.userType})` : ''}
              </dd>
              <dt>Submitted</dt>
              <dd>{formatDateTime(report.createdAt)}</dd>
              <dt>System routing</dt>
              <dd>{report.proposedTradeUnit.name}</dd>
              <dt>People affected</dt>
              <dd>{PEOPLE[report.affectedPeople ?? -1] ?? 'Not answered'}</dd>
              <dt>Safety hazard</dt>
              <dd>{yesNo(report.safetyHazard)}</dd>
              <dt>Area unusable</dt>
              <dd>{yesNo(report.blocksUse)}</dd>
            </dl>
          </div>

          {report.jobOrderForm && (
            <div className="card">
              <div className="card-head">
                <h2>Job Order Form</h2>
                <FormStatusBadge status={report.jobOrderForm.status} />
              </div>
              <p>
                <Link to={`/forms/${report.jobOrderForm.id}`}>
                  <strong>{report.jobOrderForm.formNo}</strong>
                </Link>{' '}
                signed by the reporter · {formatDateTime(report.jobOrderForm.submittedAt)}
                {report.jobOrderForm.revision > 1 && ` · revision ${report.jobOrderForm.revision}`}
              </p>
            </div>
          )}
          <PriorityPanel report={report} onChanged={() => void load()} />
          <DuplicatesPanel report={report} onChanged={() => void load()} />

          <div className="card">
            <h2>Status history</h2>
            <ol className="timeline">
              {report.logs.map((l) => (
                <li
                  key={l.id}
                  style={{ '--dot': `var(--st-${STATUS_DOT[isProgressUpdate(l) ? 'IN_PROGRESS' : l.newStatus]})` } as CSSProperties}
                >
                  <div className="tl-head">
                    <span className="tl-status">
                      {isProgressUpdate(l) ? 'Progress update' : statusLabel(l.newStatus)}
                    </span>
                    <span className="tl-time">{formatDateTime(l.createdAt)}</span>
                  </div>
                  {l.remarks && <p>{l.remarks}</p>}
                  {mediaUrl(l.photoUrl) && (
                    <a href={mediaUrl(l.photoUrl)} target="_blank" rel="noreferrer">
                      <img
                        className="thumb"
                        src={mediaUrl(l.photoUrl)}
                        alt="Work photo"
                      />
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {report.feedback && (
            <div className="card">
              <h2>Reporter feedback</h2>
              <p className="stars">
                {'★'.repeat(report.feedback.rating)}
                {'☆'.repeat(5 - report.feedback.rating)}{' '}
                <span className="muted">({report.feedback.rating}/5)</span>
              </p>
              {report.feedback.comment && <p>{report.feedback.comment}</p>}
              <small className="muted">{formatDateTime(report.feedback.createdAt)}</small>
            </div>
          )}
        </div>

        <div>
          {report.jobOrder && report.duplicateOfId && job?.status === 'CANCELLED' ? (
            <>
              <RoutePanel key={report.id} report={report} tradeUnits={tradeUnits} onDone={() => void load()} />
              <JobPanel job={job} onDone={() => void load()} />
            </>
          ) : report.jobOrder ? (
            job && <JobPanel job={job} onDone={() => void load()} />
          ) : (
            <RoutePanel
              key={report.id}
              report={report}
              tradeUnits={tradeUnits}
              onDone={() => void load()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const PEOPLE = ['Just the reporter', '2 to 10 people', '11 to 50 people', 'More than 50 people'];
const yesNo = (v: boolean | null) => (v === null ? 'Not answered' : v ? 'Yes' : 'No');

/* ---------- technician picker helpers ---------- */

// least busy first, so the coordinator sees who has capacity
function byWorkload(list: Technician[]): Technician[] {
  return [...list].sort(
    (a, b) => a.workload.active - b.workload.active || a.fullName.localeCompare(b.fullName),
  );
}

// e.g. "Ana Cruz (2 active jobs, survey 78)"; "survey" marks a technician
// from another trade unit who qualified for this one in the skills survey
function technicianOption(t: Technician): string {
  const w = t.workload;
  const parts = [`${w.active} active job${w.active === 1 ? '' : 's'}`];
  if (w.delayed) parts.push(`${w.delayed} delayed`);
  if (t.match && !t.match.primary && t.match.surveyScore !== null) {
    parts.push(`${t.tradeUnit?.name ?? 'other unit'}, survey ${t.match.surveyScore}`);
  } else if (t.match?.surveyScore != null) {
    parts.push(`survey ${t.match.surveyScore}`);
  }
  return `${t.fullName} (${parts.join(', ')})`;
}

/* ---------- confirm routing and generate the job order ---------- */

function RoutePanel({
  report,
  tradeUnits,
  onDone,
}: {
  report: Report;
  tradeUnits: TradeUnit[];
  onDone: () => void;
}) {
  const [unitId, setUnitId] = useState(report.proposedTradeUnit.id);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [technicianId, setTechnicianId] = useState('');
  const [materials, setMaterials] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Technician[]>('/job-orders/technicians', {
        params: { tradeUnitId: unitId },
      })
      .then((r) => {
        if (!cancelled) {
          setTechnicians(r.data);
          setTechnicianId('');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  const changedUnit = unitId !== report.proposedTradeUnit.id;
  const canMarkReview = report.status === 'SUBMITTED' || changedUnit;
  const linkedTo = report.duplicateOfId ? report.duplicateOf : null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
    onDone();
    setBusy(false);
  }

  // optional: park the report as "under review" and assign it later
  const markUnderReview = () =>
    run(async () => {
      await api.patch(`/reports/${report.id}/route`, {
        tradeUnitId: unitId,
        remarks: remarks.trim() || undefined,
      });
    });

  // one step: confirms or changes the routing and creates the job order
  const generate = () =>
    run(async () => {
      await api.post('/job-orders', {
        reportId: report.id,
        tradeUnitId: unitId,
        technicianId: technicianId || undefined,
        materialsNote: materials.trim() || undefined,
        targetDate: targetDate || undefined,
        routingRemarks: remarks.trim() || undefined,
      });
    });

  // one problem = one job order: a linked report is handled with its main report
  if (report.duplicateOfId) {
    return (
      <div className="card">
        <h2>Handled with another report</h2>
        <p>
          This report is the same problem as{' '}
          <Link to={`/reports/${report.duplicateOfId}`}>an earlier report</Link>
          {linkedTo?.jobOrder ? (
            <>
              , handled under job order <strong>{linkedTo.jobOrder.jobOrderNo}</strong>
              {linkedTo.jobOrder.technician && <> by {linkedTo.jobOrder.technician.fullName}</>}.
            </>
          ) : (
            ', which does not have a job order yet. Create it on that report.'
          )}
        </p>
        <p className="muted small">
          Its status follows that report, and its reporter is kept informed. To handle it
          separately, unlink it under “Possible duplicates”.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Review and assign</h2>
      <p className="muted">
        The system proposed <strong>{report.proposedTradeUnit.name}</strong> based on
        the issue category. Keep it or choose another trade unit, then generate the
        job order. The routing is confirmed in the same step.
      </p>

      <label className="field">
        Trade unit
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          {tradeUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.id === report.proposedTradeUnit.id ? ' (proposed)' : ''}
            </option>
          ))}
        </select>
      </label>
      {changedUnit && (
        <p className="notice">
          This will be recorded as a reassignment from {report.proposedTradeUnit.name}.
        </p>
      )}

      <RecommendationBox reportId={report.id} tradeUnitId={unitId} onRecommend={setTechnicianId} />

      <label className="field">
        Technician
        <select
          value={technicianId}
          onChange={(e) => setTechnicianId(e.target.value)}
        >
          <option value="">Assign later</option>
          {byWorkload(technicians).map((t) => (
            <option key={t.id} value={t.id}>
              {technicianOption(t)}
            </option>
          ))}
        </select>
      </label>
      {technicians.length === 0 && (
        <p className="muted">No active technicians in this trade unit yet.</p>
      )}

      <label className="field">
        Materials needed (optional)
        <textarea
          rows={2}
          value={materials}
          onChange={(e) => setMaterials(e.target.value)}
          placeholder="Leave blank if unknown"
        />
      </label>

      <label className="field">
        Target completion date (optional)
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />
      </label>

      <label className="field">
        Routing remarks (optional)
        <input
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Shown in the status history"
        />
      </label>

      <p className="notice">
        Materials and target date stay blank when unknown. The system never fills
        them in for you.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={() => void generate()}
          disabled={busy}
        >
          {busy ? 'Working...' : 'Confirm routing and generate job order'}
        </button>
        <button
          className="btn"
          onClick={() => void markUnderReview()}
          disabled={busy || !canMarkReview}
          title="Save the routing now and create the job order later"
        >
          Mark as under review
        </button>
      </div>
    </div>
  );
}

/* ---------- job order details and technician assignment ---------- */

function JobPanel({ job, onDone }: { job: JobOrder; onDone: () => void }) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [technicianId, setTechnicianId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReassign = job.status === 'ASSIGNED';

  useEffect(() => {
    if (!canReassign) return undefined;
    let cancelled = false;
    api
      .get<Technician[]>('/job-orders/technicians', {
        params: { tradeUnitId: job.tradeUnitId },
      })
      .then((r) => {
        if (!cancelled) setTechnicians(r.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [canReassign, job.tradeUnitId]);

  async function assign() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/job-orders/${job.id}/technician`, { technicianId });
      setTechnicianId('');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  const options = byWorkload(technicians.filter((t) => t.id !== job.technicianId));
  const history = job.assignments ?? [];
  const lastDecline = history.find((a) => a.status === 'DECLINED') ?? null;
  const declinedBy = new Set(history.filter((a) => a.status === 'DECLINED').map((a) => a.technicianId));

  return (
    <div className="card">
      <h2>Job order {job.jobOrderNo}</h2>
      {job.status === 'CANCELLED' && (
        <div className="notice">
          <strong>Cancelled: same problem as another report.</strong>{' '}
          {job.mergedInto ? (
            <>
              The work continues under{' '}
              <Link to={`/reports/${job.mergedInto.reportId}`}>{job.mergedInto.jobOrderNo}</Link>.
            </>
          ) : (
            job.cancelReason
          )}
          <div className="small muted">
            Unlink the reports under “Possible duplicates” if this job is needed after all.
          </div>
        </div>
      )}
      <dl className="kv">
        <dt>Status</dt>
        <dd>
          <StatusBadge status={job.status} />
        </dd>
        <dt>Trade unit</dt>
        <dd>{job.tradeUnit.name}</dd>
        <dt>Technician</dt>
        <dd>
          {job.technician?.fullName ?? (job.assignmentStatus === 'DECLINED' ? '' : 'Not yet assigned')}{' '}
          <AssignmentFlag job={job} />
        </dd>
        <dt>Materials</dt>
        <dd>{job.materialsNote ?? 'Not specified'}</dd>
        <dt>Target date</dt>
        <dd>
          {formatDate(job.targetDate)} {isOverdue(job) && <Flag kind="danger">Overdue</Flag>}
        </dd>
        <dt>Created</dt>
        <dd>{formatDateTime(job.createdAt)}</dd>
        {job.verifiedAt && (
          <>
            <dt>Verified</dt>
            <dd>
              {job.verifiedBy?.fullName ?? 'Coordinator'} · {formatDateTime(job.verifiedAt)}
            </dd>
          </>
        )}
      </dl>

      {lastDecline && !job.technician && (
        <div className="warn">
          <strong>{lastDecline.technician.fullName} declined this job</strong>
          {lastDecline.respondedAt && <> on {formatDateTime(lastDecline.respondedAt)}</>}
          <p>Reason: “{lastDecline.declineReason}”</p>
          <span className="muted">Choose another qualified technician below.</span>
        </div>
      )}
      {job.assignmentStatus === 'PENDING' && job.technician && (
        <p className="notice">
          Waiting for {job.technician.fullName} to accept or decline. They cannot start work
          until they accept. You can still give the job to someone else.
        </p>
      )}

      {canReassign ? (
        <>
          <label className="field">
            {job.technician ? 'Change technician' : lastDecline ? 'Reassign to' : 'Assign technician'}
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
            >
              <option value="">Select technician</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {technicianOption(t)}
                  {declinedBy.has(t.id) ? ' · declined this job' : ''}
                </option>
              ))}
            </select>
          </label>
          {options.length === 0 && (
            <p className="muted">
              No other technicians are available in this trade unit.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
          <button
            className="btn btn-primary"
            onClick={() => void assign()}
            disabled={busy || !technicianId}
          >
            {busy ? 'Saving...' : 'Save technician'}
          </button>
        </>
      ) : (
        <p className="muted">
          The technician can only be changed while the job is Assigned.
        </p>
      )}
      <AssignmentHistory job={job} />
      <VerifySection job={job} onDone={onDone} />
      <DelaySection job={job} onDone={onDone} />
      <div className="section">
        <PdfButton job={job} />
      </div>
    </div>
  );
}

/* ---------- who the job was offered to, and their answers ---------- */

const ANSWER_LABEL: Record<AssignmentStatus, string> = {
  PENDING: 'Waiting for reply',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Withdrawn',
};

function AssignmentHistory({ job }: { job: JobOrder }) {
  const history = job.assignments ?? [];
  if (history.length === 0) return null;
  return (
    <div className="section">
      <h2>Assignment history</h2>
      <ul className="item-list">
        {history.map((a) => (
          <li key={a.id} className="assignment-row">
            <span className="item-main">
              <strong>{a.technician.fullName}</strong>
              <span className="muted">
                Offered by {a.assignedBy.fullName} · {formatDateTime(a.assignedAt)}
                {a.respondedAt && ` · answered ${formatDateTime(a.respondedAt)}`}
              </span>
              {a.declineReason && <span className="decline-reason">“{a.declineReason}”</span>}
            </span>
            <span className={`answer answer-${a.status}`}>{ANSWER_LABEL[a.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- material delay notices ---------- */

function DelaySection({ job, onDone }: { job: JobOrder; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [materials, setMaterials] = useState('');
  const [revisedDate, setRevisedDate] = useState('');
  const [resumeNote, setResumeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delays = job.delays ?? [];
  const active = delays.find((d) => !d.resolvedAt) ?? null;
  const canRecord = job.status === 'ASSIGNED' || job.status === 'IN_PROGRESS';

  async function send(path: 'delay' | 'resume', body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/job-orders/${job.id}/${path}`, body);
      setOpen(false);
      setReason('');
      setMaterials('');
      setRevisedDate('');
      setResumeNote('');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="section">
      <h2>Material delays</h2>

      {delays.length === 0 && <p className="muted">No delays recorded for this job.</p>}
      {delays.map((d) => (
        <div className="delay-item" key={d.id}>
          <strong>{d.reason}</strong>
          {d.materialsNote && <div>Materials: {d.materialsNote}</div>}
          <div>
            Revised target date:{' '}
            {d.revisedTargetDate ? formatDate(d.revisedTargetDate) : 'not yet set'}
          </div>
          <small className="muted">
            Reported by {d.reportedBy.fullName} on {formatDateTime(d.createdAt)}
            {d.resolvedAt ? ` · resolved ${formatDateTime(d.resolvedAt)}` : ' · still open'}
          </small>
        </div>
      ))}

      {active && (
        <div className="warn">
          <p>
            <strong>This job is delayed.</strong> Resume it once the delay is resolved.
          </p>
          <label className="field">
            Remarks (optional)
            <input
              value={resumeNote}
              onChange={(e) => setResumeNote(e.target.value)}
              placeholder="Example: materials delivered"
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void send('resume', { remarks: resumeNote.trim() || undefined })}
          >
            {busy ? 'Saving...' : 'Resolve delay and resume'}
          </button>
        </div>
      )}

      {!active && canRecord && !open && (
        <button className="btn" onClick={() => setOpen(true)}>
          Record material delay
        </button>
      )}

      {!active && canRecord && open && (
        <div>
          <label className="field">
            Reason for the delay
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="field">
            Materials needed (optional)
            <input value={materials} onChange={(e) => setMaterials(e.target.value)} />
          </label>
          <label className="field">
            Revised target date (optional)
            <input
              type="date"
              value={revisedDate}
              onChange={(e) => setRevisedDate(e.target.value)}
            />
          </label>
          <p className="notice">
            Leave the date blank if none has been established. The notice will say no
            revised date yet, and the system will not guess one.
          </p>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={busy || reason.trim().length < 3}
              onClick={() =>
                void send('delay', {
                  reason: reason.trim(),
                  materialsNote: materials.trim() || undefined,
                  revisedTargetDate: revisedDate || undefined,
                })
              }
            >
              {busy ? 'Saving...' : 'Save delay notice'}
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/* ---------- completion verification ---------- */

function VerifySection({ job, onDone }: { job: JobOrder; onDone: () => void }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (job.status !== 'COMPLETED') return null;

  async function submit(approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/job-orders/${job.id}/verify`, {
        approved,
        remarks: remarks.trim() || undefined,
      });
      setRemarks('');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="section">
      <h2>Completion verification</h2>
      <p className="muted">
        The technician marked this job as completed. Check the completion photo in the
        status history, then verify the work or send it back for rework.
      </p>
      <label className="field">
        Remarks (required when sending back)
        <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit(true)}>
          Verify and close
        </button>
        <button
          className="btn"
          disabled={busy || remarks.trim().length < 3}
          onClick={() => void submit(false)}
        >
          Send back for rework
        </button>
      </div>
    </div>
  );
}

/* ---------- printable job order ---------- */

function PdfButton({ job }: { job: JobOrder }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      // fetched through axios so the auth token is sent
      const res = await api.get<Blob>(`/job-orders/${job.id}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${job.jobOrderNo}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  return (
    <>
      <button className="btn" onClick={() => void download()} disabled={busy}>
        {busy ? 'Preparing PDF...' : 'Download printable job order (PDF)'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}