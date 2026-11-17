import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_URL, api, errorMessage } from '../api';
import { formatDate, formatDateTime, isProgressUpdate, locationText } from '../format';
import { ErrorBox, StatusBadge, UrgencyBadge } from '../ui';
import type {
  JobOrder,
  Report,
  ReportOptions,
  Technician,
  TradeUnit,
} from '../types';
import { useRealtime } from '../socket';

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
          <Link to="/reports">← Back to reports</Link>
          <h1>{report.category.name}</h1>
        </div>
        <StatusBadge status={report.status} />
      </div>

      <div className="grid-2">
        <div>
          <div className="card">
            {report.photos.map((p) => (
              <img
                key={p.id}
                className="photo"
                src={`${API_URL}${p.storageUrl}`}
                alt="Reported issue"
              />
            ))}
            <p>{report.description}</p>
            <dl className="kv">
              <dt>Location</dt>
              <dd>{locationText(report.location)}</dd>
              <dt>Urgency</dt>
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
            </dl>
          </div>

          <div className="card">
            <h2>Status history</h2>
            <ol className="timeline">
              {report.logs.map((l) => (
                <li key={l.id}>
                  {isProgressUpdate(l) ? (
                    <span className="badge s-IN_PROGRESS">Progress update</span>
                  ) : (
                    <StatusBadge status={l.newStatus} />
                  )}
                  {l.remarks && <p>{l.remarks}</p>}
                  {l.photoUrl && (
                    <a href={`${API_URL}${l.photoUrl}`} target="_blank" rel="noreferrer">
                      <img
                        className="thumb"
                        src={`${API_URL}${l.photoUrl}`}
                        alt="Work photo"
                      />
                    </a>
                  )}
                  <small className="muted">{formatDateTime(l.createdAt)}</small>
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
          {report.jobOrder ? (
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

      <label className="field">
        Technician
        <select
          value={technicianId}
          onChange={(e) => setTechnicianId(e.target.value)}
        >
          <option value="">Assign later</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName}
            </option>
          ))}
        </select>
      </label>

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

  const options = technicians.filter((t) => t.id !== job.technicianId);

  return (
    <div className="card">
      <h2>Job order {job.jobOrderNo}</h2>
      <dl className="kv">
        <dt>Status</dt>
        <dd>
          <StatusBadge status={job.status} />
        </dd>
        <dt>Trade unit</dt>
        <dd>{job.tradeUnit.name}</dd>
        <dt>Technician</dt>
        <dd>{job.technician?.fullName ?? 'Not yet assigned'}</dd>
        <dt>Materials</dt>
        <dd>{job.materialsNote ?? 'Not specified'}</dd>
        <dt>Target date</dt>
        <dd>{formatDate(job.targetDate)}</dd>
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

      {canReassign ? (
        <>
          <label className="field">
            {job.technician ? 'Change technician' : 'Assign technician'}
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
            >
              <option value="">Select technician</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
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
      <VerifySection job={job} onDone={onDone} />
      <DelaySection job={job} onDone={onDone} />
      <div className="section">
        <PdfButton job={job} />
      </div>
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