import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, mediaUrl } from '../api';
import {
  formatDate,
  formatDateTime,
  isOverdue,
  isProgressUpdate,
  locationText,
  statusLabel,
  userTypeLabel,
} from '../format';
import {
  Breadcrumb,
  ErrorBox,
  Flag,
  FormStatusBadge,
  PriorityBadge,
  StatusBadge,
  StatusStepper,
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
      const [first, o] = await Promise.all([
        api.get<Report>(`/reports/${id}`),
        api.get<ReportOptions>('/reports/options'),
      ]);
      let r = first;
      // opening a new report puts it Under review (the reporter is told)
      if (r.data.status === 'SUBMITTED' && !r.data.jobOrder && !r.data.duplicateOfId) {
        try {
          const res = await api.patch<{ changed: boolean }>(`/reports/${id}/review`);
          if (res.data.changed) r = await api.get<Report>(`/reports/${id}`);
        } catch {
          // still show the report; it stays Submitted until opened again
        }
      }
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

  const hasJob = Boolean(report.jobOrder);
  // a linked report whose own job order was cancelled as merged
  const mergedAway = Boolean(report.jobOrder && report.duplicateOfId && job?.status === 'CANCELLED');

  return (
    <div>
      <Breadcrumb
        parent={hasJob ? 'Job Orders' : 'Pending Reports'}
        to={hasJob ? '/job-orders' : '/queue'}
        current={report.category.name}
      />
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{report.category.name}</h1>
          <p className="muted subtitle">
            {locationText(report.location)} · submitted {formatDateTime(report.createdAt)}
            {report.jobOrder ? ` · ${report.jobOrder.jobOrderNo}` : ''}
          </p>
        </div>
        <div className="head-badges">
          <StatusBadge status={report.status} />
          {job && isOverdue(job) && <Flag kind="danger">Overdue</Flag>}
          <PriorityBadge priority={report.priority} />
        </div>
      </div>

      <div className="card card-tight">
        <StatusStepper status={report.status} />
      </div>

      <div className="grid-2 detail-grid">
        <div className="detail-main">
          <div className="card detail-summary">
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
              <dt>Reported by</dt>
              <dd>
                {report.reporter.fullName}
                {report.reporter.userType ? ` · ${userTypeLabel(report.reporter.userType)}` : ''}
              </dd>
              <dt>Submitted</dt>
              <dd>{formatDateTime(report.createdAt)}</dd>
              {!hasJob && (
                <>
                  <dt>System routing</dt>
                  <dd>{report.proposedTradeUnit.name}</dd>
                </>
              )}
              <dt>People affected</dt>
              <dd>{PEOPLE[report.affectedPeople ?? -1] ?? 'Not answered'}</dd>
              <dt>Safety hazard</dt>
              <dd>{yesNo(report.safetyHazard)}</dd>
              <dt>Area unusable</dt>
              <dd>{yesNo(report.blocksUse)}</dd>
            </dl>
          </div>

          {!hasJob && report.jobOrderForm && (
            <div className="card">
              <h2>Job Order Form</h2>
              <FormRow form={report.jobOrderForm} reporter={report.reporter.fullName} />
            </div>
          )}

          <div className="card">
            <h2>Status history</h2>
            <ol className="timeline">
              {[...report.logs].reverse().map((l) => (
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
        </div>

        <div className="detail-side">
          {hasJob && !mergedAway ? (
            job && <JobSideCard key={job.id} report={report} job={job} onDone={() => void load()} />
          ) : (
            <TriageSideCard
              key={report.id}
              report={report}
              tradeUnits={tradeUnits}
              mergedJob={mergedAway ? job : null}
              onDone={() => void load()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- side card: tabs ---------- */

interface TabDef {
  id: string;
  label: string;
  extra?: ReactNode;
}

function SideTabs({
  label,
  tabs,
  active,
  onSelect,
  children,
}: {
  label: string;
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="card side-tabs">
      <div className="tabs" role="tablist" aria-label={label}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            className={`tab${active === t.id ? ' tab-active' : ''}`}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
            {t.extra}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

// panels stay mounted so their state (and counts) survive switching tabs
function TabPanel({ id, active, children }: { id: string; active: string; children: ReactNode }) {
  return (
    <div className="tab-panel" role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id}>
      {children}
    </div>
  );
}

const ActionDot = () => <span className="tab-dot" aria-label="Action needed" />;

// before a job order exists: route it, check the priority, check duplicates
function TriageSideCard({
  report,
  tradeUnits,
  mergedJob,
  onDone,
}: {
  report: Report;
  tradeUnits: TradeUnit[];
  mergedJob: JobOrder | null;
  onDone: () => void;
}) {
  const [tab, setTab] = useState('rev');
  const [openDups, setOpenDups] = useState(0);
  return (
    <SideTabs
      label="Report actions"
      active={tab}
      onSelect={setTab}
      tabs={[
        { id: 'rev', label: 'Review and assign' },
        { id: 'pri', label: 'Priority', extra: report.needsReview ? <ActionDot /> : undefined },
        {
          id: 'dup',
          label: 'Possible duplicates',
          extra: openDups > 0 ? <span className="tab-count tab-count-alert">{openDups}</span> : undefined,
        },
      ]}
    >
      <TabPanel id="rev" active={tab}>
        <RoutePanel report={report} tradeUnits={tradeUnits} onDone={onDone} />
        {mergedJob && (
          <div className="section">
            <JobPanel report={report} job={mergedJob} onDone={onDone} />
          </div>
        )}
      </TabPanel>
      <TabPanel id="pri" active={tab}>
        <PriorityPanel report={report} onChanged={onDone} />
      </TabPanel>
      <TabPanel id="dup" active={tab}>
        <DuplicatesPanel report={report} onChanged={onDone} onOpenCount={setOpenDups} />
      </TabPanel>
    </SideTabs>
  );
}

// once the job order exists: the job, then the verification of the work
function JobSideCard({ report, job, onDone }: { report: Report; job: JobOrder; onDone: () => void }) {
  const toVerify = job.status === 'COMPLETED';
  const [tab, setTab] = useState(toVerify ? 'ver' : 'jo');
  return (
    <SideTabs
      label="Job order and verification"
      active={tab}
      onSelect={setTab}
      tabs={[
        { id: 'jo', label: 'Job order' },
        { id: 'ver', label: 'Completion verification', extra: toVerify ? <ActionDot /> : undefined },
      ]}
    >
      <TabPanel id="jo" active={tab}>
        <JobPanel report={report} job={job} onDone={onDone} />
      </TabPanel>
      <TabPanel id="ver" active={tab}>
        <VerifySection report={report} job={job} onDone={onDone} />
      </TabPanel>
    </SideTabs>
  );
}

// the reporter's signed Job Order Form, as one row
function FormRow({ form, reporter }: { form: NonNullable<Report['jobOrderForm']>; reporter: string }) {
  return (
    <>
      <div className="form-row">
        <span className="item-main">
          <strong>{form.formNo}</strong>
          <span className="muted">
            Signed by {reporter} on {formatDate(form.submittedAt)}
            {form.revision > 1 && ` · revision ${form.revision}`}
          </span>
        </span>
        <FormStatusBadge status={form.status} />
      </div>
      <div className="btn-row">
        <Link className="btn btn-small" to={`/forms/${form.id}`}>
          Open the form
        </Link>
      </div>
    </>
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

const isFull = (t: Technician) => t.workload.active >= t.workload.limit;

// e.g. "Ana Cruz (2 of 5 active jobs, survey 78)"; "survey" marks a technician
// from another trade unit who qualified for this one in the skills survey
function technicianOption(t: Technician): string {
  const w = t.workload;
  const parts = [isFull(t) ? `full: ${w.active} of ${w.limit} active jobs` : `${w.active} of ${w.limit} active jobs`];
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
      <div>
        <h2 className="panel-title">Handled with another report</h2>
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
    <div>
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
            <option key={t.id} value={t.id} disabled={isFull(t)}>
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
          type="button"
          className="btn btn-primary"
          onClick={() => void generate()}
          disabled={busy}
        >
          {busy ? 'Working...' : 'Confirm routing and generate job order'}
        </button>
      </div>
    </div>
  );
}

/* ---------- job order details and technician assignment ---------- */

// the technician's answer to the current offer, for the job panel header
function AnswerFlag({ job }: { job: JobOrder }) {
  if (job.status === 'CANCELLED') return <Flag kind="danger">Cancelled</Flag>;
  if (!job.technicianId) {
    return job.assignmentStatus === 'DECLINED' ? (
      <Flag kind="danger">Declined · reassign</Flag>
    ) : (
      <Flag kind="warn">Unassigned</Flag>
    );
  }
  if (job.assignmentStatus === 'PENDING') return <Flag kind="info">Awaiting reply</Flag>;
  if (job.assignmentStatus === 'ACCEPTED') return <Flag kind="ok">Accepted</Flag>;
  return null;
}

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

function JobPanel({ report, job, onDone }: { report: Report; job: JobOrder; onDone: () => void }) {
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
  const pickLabel = job.technician ? 'Change technician' : lastDecline ? 'Reassign to' : 'Assign technician';

  return (
    <>
      <div className="card-head">
        <strong className="panel-title">{job.jobOrderNo}</strong>
        <AnswerFlag job={job} />
      </div>
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
        <dd>{job.technician?.fullName ?? <span className="muted">Not yet assigned</span>}</dd>
        <dt>Materials</dt>
        <dd>{job.materialsNote ?? <span className="muted">Not specified</span>}</dd>
        <dt>Target date</dt>
        <dd>
          {formatDate(job.targetDate)} {isOverdue(job) && <Flag kind="danger">Overdue</Flag>}
        </dd>
        <dt>Created</dt>
        <dd>{formatDate(job.createdAt)}</dd>
        {job.status !== 'CANCELLED' && (
          <>
            <dt>Verified</dt>
            {job.verifiedAt ? (
              <dd>
                {job.verifiedBy?.fullName ?? 'Coordinator'} · {formatDateTime(job.verifiedAt)}
              </dd>
            ) : (
              <dd className="muted">Not yet</dd>
            )}
          </>
        )}
      </dl>

      {job.assignmentStatus === 'PENDING' && job.technician && (
        <p className="notice pending-note">
          Waiting for {job.technician.fullName} to accept or decline. They can't start work until
          they accept. You can still give the job to someone else.
        </p>
      )}

      {canReassign ? (
        <div className="section reassign">
          <h2>{pickLabel}</h2>
          {lastDecline && !job.technician ? (
            <div className="warn">
              <strong>{lastDecline.technician.fullName} declined this job</strong>
              {lastDecline.respondedAt && <> on {formatDateTime(lastDecline.respondedAt)}</>}
              <p>Reason: “{lastDecline.declineReason}”</p>
              <span className="muted">Choose another qualified technician below.</span>
            </div>
          ) : (
            <p className="muted small">Only possible while the job is Assigned, before work starts.</p>
          )}
          <label className="field">
            <span className="sr-only">Technician</span>
            <select aria-label={pickLabel} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">Select technician</option>
              {options.map((t) => (
                <option key={t.id} value={t.id} disabled={isFull(t)}>
                  {technicianOption(t)}
                  {declinedBy.has(t.id) ? ' · declined this job' : ''}
                </option>
              ))}
            </select>
          </label>
          {options.length === 0 && (
            <p className="muted">No other technicians are available in this trade unit.</p>
          )}
          {error && <p className="error-text">{error}</p>}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void assign()}
            disabled={busy || !technicianId}
          >
            {busy ? 'Saving...' : 'Save technician'}
          </button>
        </div>
      ) : (
        job.status !== 'CANCELLED' && (
          <div className="locked-row">
            <LockIcon />
            <span>The technician can only be changed while the job is Assigned.</span>
          </div>
        )
      )}

      {report.jobOrderForm && (
        <div className="section">
          <h2>Job Order Form</h2>
          <FormRow form={report.jobOrderForm} reporter={report.reporter.fullName} />
        </div>
      )}
      <AssignmentHistory job={job} />
      <DelaySection job={job} onDone={onDone} />
      <div className="btn-row">
        <PdfButton job={job} />
      </div>
    </>
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
      {history.map((a) => (
        <div key={a.id} className="assignment-row">
          <span className="item-main">
            <strong>{a.technician.fullName}</strong>
            <span className="muted">
              Offered {formatDateTime(a.assignedAt)} by {a.assignedBy.fullName}
              {a.respondedAt && ` · answered ${formatDateTime(a.respondedAt)}`}
            </span>
            {a.declineReason && <p className="decline-reason muted">“{a.declineReason}”</p>}
          </span>
          <span className={`answer answer-${a.status}`}>{ANSWER_LABEL[a.status]}</span>
        </div>
      ))}
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

      {delays.length === 0 && !open && <p className="muted">No delays recorded for this job.</p>}
      {delays.map((d) => (
        <div className="delay-item" key={d.id}>
          <strong>{d.reason}</strong>
          <p className="muted">
            {d.materialsNote && `Materials: ${d.materialsNote} · `}
            Revised target date: {d.revisedTargetDate ? formatDate(d.revisedTargetDate) : 'not yet set'}
          </p>
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
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void send('resume', { remarks: resumeNote.trim() || undefined })}
          >
            {busy ? 'Saving...' : 'Resolve delay and resume'}
          </button>
        </div>
      )}

      {!active && canRecord && !open && (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Record material delay
        </button>
      )}

      {!active && canRecord && open && (
        <div className="delay-form">
          <label className="field">
            Reason for the delay
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Example: waiting for a part from the supplier"
            />
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
            Leave the date blank if none has been set. The notice will say there's no revised date
            yet, and the system won't guess one.
          </p>
          <div className="btn-row">
            <button
              type="button"
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
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
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

function VerifySection({ report, job, onDone }: { report: Report; job: JobOrder; onDone: () => void }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const who = job.technician?.fullName ?? 'the technician';

  return (
    <>
      {job.status === 'COMPLETED' ? (
        <>
          <div className="card-head">
            <strong className="panel-title">Check the repair</strong>
            <span className="action-tag">Action needed</span>
          </div>
          <p className="muted">
            The technician marked this job as completed. Check the completion photo in the status
            history, then verify the work or send it back for rework.
          </p>
          <label className="field">
            Remarks (required when sending back)
            <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit(true)}>
              Verify and close
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || remarks.trim().length < 3}
              onClick={() => void submit(false)}
            >
              Send back for rework
            </button>
          </div>
        </>
      ) : job.verifiedAt ? (
        <div className="empty-state">
          <strong>Repair verified</strong>
          <p className="muted">
            {job.verifiedBy?.fullName ?? 'A coordinator'} verified the work on{' '}
            {formatDateTime(job.verifiedAt)}.
          </p>
        </div>
      ) : (
        <div className="empty-state">
          <strong>Nothing to verify yet</strong>
          <p className="muted">
            {job.status === 'CANCELLED'
              ? 'This job order was cancelled.'
              : `Verification opens when ${who} marks the job completed and uploads a completion photo.`}
          </p>
        </div>
      )}

      <div className="section">
        <h2>Reporter feedback</h2>
        {report.feedback ? (
          <>
            <p className="stars">
              {'★'.repeat(report.feedback.rating)}
              {'☆'.repeat(5 - report.feedback.rating)}{' '}
              <span className="muted">({report.feedback.rating}/5)</span>
            </p>
            {report.feedback.comment && <p>{report.feedback.comment}</p>}
            <small className="muted">{formatDateTime(report.feedback.createdAt)}</small>
          </>
        ) : (
          <p className="muted">Shown here after the repair is verified and the reporter rates it.</p>
        )}
      </div>
    </>
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
      <button type="button" className="btn" onClick={() => void download()} disabled={busy}>
        {busy ? 'Preparing PDF...' : 'Download printable job order (PDF)'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}