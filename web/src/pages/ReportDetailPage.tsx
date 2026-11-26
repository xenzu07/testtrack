import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, mediaUrl } from '../api';
import {
  formatDate,
  formatDay,
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
  JobOrderFormView,
  Report,
  ReportOptions,
  StatusLog,
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

// what a history entry was, in the coordinator's words
function logTitle(l: StatusLog): { title: string; dot: string } {
  const r = l.remarks ?? '';
  if (isProgressUpdate(l)) return { title: 'Progress update', dot: 'progress' };
  if (r.startsWith('Job Order Form') && r.includes(' approved')) return { title: 'Request accepted', dot: 'review' };
  if (r.startsWith('Job Order Form') && r.includes('returned for changes')) return { title: 'Form returned', dot: 'delayed' };
  if (r.startsWith('Job Order Form') && r.includes('received by the GSO')) return { title: 'Form received', dot: 'review' };
  if (r.startsWith('Linked to an earlier report')) return { title: 'Closed · linked as a duplicate', dot: 'closed' };
  return { title: statusLabel(l.newStatus), dot: STATUS_DOT[l.newStatus] };
}

// the link entry, told with the earlier report's details
function linkedText(l: StatusLog, report: Report): string | null {
  const main = report.duplicateOf;
  if (!main || !(l.remarks ?? '').startsWith('Linked to an earlier report')) return null;
  const what = main.category?.name ?? 'an earlier report';
  const when = main.createdAt ? ` reported ${formatDay(main.createdAt)}` : '';
  const who = main.reporter ? ` by ${main.reporter.fullName}` : '';
  return `Same problem as ${what}${when}${who}. Work continues there.`;
}

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
      let changed = false;
      // opening a new report puts it Under review (the reporter is told)
      if (r.data.status === 'SUBMITTED' && !r.data.jobOrder && !r.data.duplicateOfId) {
        try {
          const res = await api.patch<{ changed: boolean }>(`/reports/${id}/review`);
          changed ||= res.data.changed;
        } catch {
          // still show the report; it stays Submitted until opened again
        }
      }
      // ... and marks its signed Job Order Form received
      const form = r.data.jobOrderForm;
      if (form?.status === 'SUBMITTED' && !r.data.duplicateOfId && !receiving.has(form.id)) {
        receiving.add(form.id);
        try {
          await api.post(`/job-order-forms/${form.id}/receive`);
          changed = true;
        } catch {
          // already received meanwhile, or not allowed: nothing to do
        } finally {
          receiving.delete(form.id);
        }
      }
      if (changed) r = await api.get<Report>(`/reports/${id}`);
      setReport(r.data);

      // every trade unit owns at least one category, so derive the list from it
      const units = new Map<string, TradeUnit>();
      o.data.categories.forEach((c) => units.set(c.defaultTradeUnit.id, c.defaultTradeUnit));
      setTradeUnits([...units.values()].sort((a, b) => a.name.localeCompare(b.name)));

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

  const hasJob = Boolean(report.jobOrder) && !report.duplicateOfId;

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
            {hasJob && report.jobOrder ? ` · ${report.jobOrder.jobOrderNo}` : ''}
          </p>
        </div>
        <div className="head-badges">
          <StatusBadge status={report.status} />
          {report.duplicateOfId && <Flag kind="info">Duplicate</Flag>}
          {job && hasJob && isOverdue(job) && <Flag kind="danger">Overdue</Flag>}
          <PriorityBadge priority={report.priority} />
        </div>
      </div>

      <div className="card card-tight">
        {/* a linked report stopped at review: it was closed without a job order */}
        <StatusStepper status={report.duplicateOfId ? 'UNDER_REVIEW' : report.status} />
      </div>

      <div className="grid-2 detail-grid">
        <div className="detail-main">
          <div className="card detail-summary">
            {report.photos.length === 0 && <div className="ph-photo">No photo</div>}
            {report.photos.map((p) =>
              mediaUrl(p.storageUrl) ? (
                <img key={p.id} className="photo" src={mediaUrl(p.storageUrl)} alt="Reported issue" />
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
              <dt>People affected</dt>
              <dd>{PEOPLE[report.affectedPeople ?? -1] ?? 'Not answered'}</dd>
              <dt>Safety hazard</dt>
              <dd>{yesNo(report.safetyHazard)}</dd>
              <dt>Area unusable</dt>
              <dd>{yesNo(report.blocksUse)}</dd>
            </dl>
          </div>

          <div className="card">
            <h2>Status history</h2>
            <ol className="timeline">
              {[...report.logs].reverse().map((l) => {
                const t = logTitle(l);
                return (
                  <li key={l.id} style={{ '--dot': `var(--st-${t.dot})` } as CSSProperties}>
                    <div className="tl-head">
                      <span className="tl-status">{t.title}</span>
                      <span className="tl-time">{formatDateTime(l.createdAt)}</span>
                    </div>
                    {l.remarks && <p>{linkedText(l, report) ?? l.remarks}</p>}
                    {mediaUrl(l.photoUrl) && (
                      <a href={mediaUrl(l.photoUrl)} target="_blank" rel="noreferrer">
                        <img className="thumb" src={mediaUrl(l.photoUrl)} alt="Work photo" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="detail-side">
          <div className="flow-panel">
            <StagePanel key={report.id} report={report} job={job} tradeUnits={tradeUnits} onDone={() => void load()} />
          </div>
        </div>
      </div>
    </div>
  );
}

const PEOPLE = ['Just the reporter', '2 to 10 people', '11 to 50 people', 'More than 50 people'];
const yesNo = (v: boolean | null) => (v === null ? 'Not answered' : v ? 'Yes' : 'No');

/* ====================================================================== */
/* the step-by-step panel: one stage of the report's flow at a time        */
/* ====================================================================== */

// forms being marked received right now (one request per form)
const receiving = new Set<string>();

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

function StageTop({ step, label, children }: { step?: number; label: string; children?: ReactNode }) {
  return (
    <div className="stage-top">
      <span className="stage-step">{step ? `Step ${step} of 6 · ${label}` : label}</span>
      {children}
    </div>
  );
}

function Stage({
  step,
  label,
  tag,
  title,
  lead,
  children,
}: {
  step?: number;
  label: string;
  tag?: ReactNode;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card stage">
      <StageTop step={step} label={label}>
        {tag}
      </StageTop>
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </div>
  );
}

const Locked = ({ children }: { children: ReactNode }) => (
  <div className="locked">
    <LockIcon />
    <span>{children}</span>
  </div>
);

const ActionNeeded = () => <span className="action-tag">Action needed</span>;

function StagePanel({
  report,
  job,
  tradeUnits,
  onDone,
}: {
  report: Report;
  job: JobOrder | null;
  tradeUnits: TradeUnit[];
  onDone: () => void;
}) {
  if (report.duplicateOfId) return <LinkedStage report={report} onDone={onDone} />;

  if (!report.jobOrder || !job) {
    const form = report.jobOrderForm;
    if (!form) return <NoFormStage report={report} onDone={onDone} />;
    if (form.status === 'RETURNED') return <ReturnedStage report={report} onDone={onDone} />;
    if (form.status !== 'APPROVED') return <AcceptRequestStage report={report} onDone={onDone} />;
    return <ReviewStage report={report} tradeUnits={tradeUnits} onDone={onDone} />;
  }

  switch (job.status) {
    case 'ASSIGNED':
      return <JobOrderStage report={report} job={job} onDone={onDone} />;
    case 'IN_PROGRESS':
      return <InProgressStage report={report} job={job} onDone={onDone} />;
    case 'DELAYED':
      return <DelayedStage report={report} job={job} onDone={onDone} />;
    case 'COMPLETED':
      return <VerifyStage report={report} job={job} onDone={onDone} />;
    case 'CLOSED':
      return <ClosedStage report={report} job={job} />;
    default:
      return (
        <Stage label="Job order" title={`Job order ${job.jobOrderNo}`} tag={<Flag kind="danger">Cancelled</Flag>}>
          <p className="muted">{job.cancelReason ?? 'This job order was cancelled.'}</p>
          {job.mergedInto && (
            <p>
              The work continues under{' '}
              <Link to={`/reports/${job.mergedInto.reportId}`}>{job.mergedInto.jobOrderNo}</Link>.
            </p>
          )}
        </Stage>
      );
  }
}

/* ---------- step 1: the reporter's signed job request ---------- */

// Step 1 card, in sequence. When the system suspects the report repeats an
// earlier one, the duplicate check comes first and is all that shows: Same
// problem links and closes the report (no job request to accept); Not a
// duplicate moves on to accepting or returning the job request.
function JobRequestCard({
  report,
  onDone,
  tag,
  title,
  lead,
  children,
}: {
  report: Report;
  onDone: () => void;
  tag?: ReactNode;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  // null until the suggestions have loaded
  const [openDups, setOpenDups] = useState<number | null>(null);
  const [cleared, setCleared] = useState(false);
  const onOpenCount = useCallback((n: number) => {
    setOpenDups((prev) => {
      if (prev !== null && prev > 0 && n === 0) setCleared(true);
      return n;
    });
  }, []);
  const checking = openDups !== null && openDups > 0;

  return (
    <div className="card stage">
      <StageTop step={1} label={checking ? 'Duplicate check' : 'Job request'}>
        {checking ? <ActionNeeded /> : openDups === null ? null : tag}
      </StageTop>
      {openDups === null && <p className="muted">Checking for possible duplicates...</p>}
      {checking && (
        <>
          <h2>Is this a duplicate?</h2>
        </>
      )}
      {/* always mounted: it finds the suggestions and reports how many are open */}
      <div hidden={!checking} className="stage-dup-panel">
        <DuplicatesPanel report={report} onChanged={onDone} onOpenCount={onOpenCount} />
      </div>
      {checking && (
        <Locked>Accepting or returning the job request unlocks after the duplicate check.</Locked>
      )}
      {openDups === 0 && (
        <>
          {cleared && (
            <div className="done-strip" style={{ margin: '6px 0 14px' }}>
              <CheckIcon />
              <span>
                <b>Duplicate check done</b> · not a duplicate
              </span>
            </div>
          )}
          <h2>{title}</h2>
          {lead && <p className="lead">{lead}</p>}
          {children}
        </>
      )}
    </div>
  );
}

function useForm(formId: string | undefined) {
  const [form, setForm] = useState<JobOrderFormView | null>(null);
  useEffect(() => {
    if (!formId) return undefined;
    let cancelled = false;
    api
      .get<JobOrderFormView>(`/job-order-forms/${formId}`)
      .then((r) => {
        if (!cancelled) setForm(r.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [formId]);
  return form;
}

function FormSummaryRow({ form, line }: { form: NonNullable<Report['jobOrderForm']>; line: ReactNode }) {
  return (
    <div className="form-row">
      <span className="item-main">
        <strong>{form.formNo}</strong>
        <span className="muted">{line}</span>
      </span>
      <FormStatusBadge status={form.status} />
    </div>
  );
}

function NoFormStage({ report, onDone }: { report: Report; onDone: () => void }) {
  return (
    <JobRequestCard
      report={report}
      onDone={onDone}
      tag={<Flag kind="warn">Waiting</Flag>}
      title="Waiting for the signed Job Order Form"
      lead={`${report.reporter.fullName} hasn't signed the Job Order Form for this report yet. The app asks them to sign it.`}
    >
      <Locked>Routing and the job order unlock once the signed form arrives and you accept it.</Locked>
    </JobRequestCard>
  );
}

function AcceptRequestStage({ report, onDone }: { report: Report; onDone: () => void }) {
  const summary = report.jobOrderForm!;
  const form = useForm(summary.id);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'approve' | 'return') {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/job-order-forms/${summary.id}/${action}`, action === 'return' ? { reason: reason.trim() } : {});
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <JobRequestCard
      report={report}
      onDone={onDone}
      tag={<ActionNeeded />}
      title="Accept the job request"
      lead={`${report.reporter.fullName} sent a signed Job Order Form with the report. Accept it to start routing, or return it if something is missing.`}
    >
      <FormSummaryRow
        form={summary}
        line={
          form ? (
            <>
              Signed {formatDateTime(form.signedAt)} ·{' '}
              {form.integrityOk ? 'unchanged since signing' : <span className="error-text">changed after signing</span>}
            </>
          ) : (
            `Sent ${formatDateTime(summary.submittedAt)}`
          )
        }
      />
      {form && (
        <dl className="kv">
          <dt>Requester</dt>
          <dd>
            {form.requesterName}
            {form.requesterType ? ` · ${userTypeLabel(form.requesterType)}` : ''}
          </dd>
          <dt>Department</dt>
          <dd>{form.department}</dd>
          <dt>Contact number</dt>
          <dd>{form.contactNumber}</dd>
          <dt>Work requested</dt>
          <dd>{form.workRequested}</dd>
          <dt>Best time</dt>
          <dd>{form.preferredSchedule ?? 'Any time'}</dd>
        </dl>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        {form?.receivedAt && <>Marked received automatically when you opened it, {formatDateTime(form.receivedAt)}. </>}
        <Link to={`/forms/${summary.id}`}>See the full form</Link>
      </p>

      {returning ? (
        <div className="section">
          <label className="field" style={{ marginTop: 0 }}>
            What should the reporter change?
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Example: Please add the section adviser's contact number."
            />
          </label>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={() => void act('return')}>
              {busy ? 'Sending...' : 'Return for revision'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setReturning(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('approve')}>
            <CheckIcon />
            {busy ? 'Accepting...' : 'Accept request'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setReturning(true)}>
            Return for revision
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <Locked>Routing and the job order unlock after you accept the request.</Locked>
    </JobRequestCard>
  );
}

function ReturnedStage({ report, onDone }: { report: Report; onDone: () => void }) {
  const summary = report.jobOrderForm!;
  const form = useForm(summary.id);
  return (
    <JobRequestCard
      report={report}
      onDone={onDone}
      tag={<Flag kind="warn">Returned</Flag>}
      title="Waiting for the revised form"
      lead={
        <>
          You returned the request{form?.decidedAt ? ` on ${formatDateTime(form.decidedAt)}` : ''}. It stays here until{' '}
          {report.reporter.fullName} revises and signs it again.
        </>
      }
    >
      {summary.decisionNote && (
        <div className="ask">
          <b>You asked:</b> {summary.decisionNote}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <FormSummaryRow
          form={summary}
          line={`Revision ${summary.revision} · signed ${formatDateTime(form?.signedAt ?? summary.submittedAt)}`}
        />
      </div>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        You'll get a notification when the revised form arrives. It opens here as received, ready to accept.
      </p>
      <Locked>No job order can be created until a revised form is accepted.</Locked>
    </JobRequestCard>
  );
}

/* ---------- step 2: review and assign ---------- */

function ReviewStage({ report, tradeUnits, onDone }: { report: Report; tradeUnits: TradeUnit[]; onDone: () => void }) {
  const form = useForm(report.jobOrderForm?.id);
  const [tab, setTab] = useState('rev');
  const [openDups, setOpenDups] = useState(0);
  const [hasDups, setHasDups] = useState(false);
  const tabs = [
    { id: 'rev', label: 'Review and assign' },
    { id: 'pri', label: 'Priority', extra: report.needsReview ? <ActionDot /> : undefined },
    ...(hasDups || openDups > 0
      ? [
          {
            id: 'dup',
            label: 'Possible duplicates',
            extra: openDups > 0 ? <span className="tab-count tab-count-alert">{openDups}</span> : undefined,
          },
        ]
      : []),
  ];
  return (
    <div className="card side-tabs stage-tabs">
      <div className="stage-tabs-head">
        <StageTop step={2} label="Review and assign" />
      </div>
      <div className="done-strip">
        <CheckIcon />
        <span>
          <b>Request accepted</b> · {report.jobOrderForm?.formNo}
          {form?.decidedAt ? `, ${formatDateTime(form.decidedAt)}` : ''}
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Review">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={`tab${tab === t.id ? ' tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.extra}
          </button>
        ))}
      </div>
      {/* panels stay mounted so their state (and counts) survive switching tabs */}
      <div className="tab-panel" role="tabpanel" id="panel-rev" aria-labelledby="tab-rev" hidden={tab !== 'rev'}>
        <RoutePanel report={report} tradeUnits={tradeUnits} onDone={onDone} />
      </div>
      <div className="tab-panel" role="tabpanel" id="panel-pri" aria-labelledby="tab-pri" hidden={tab !== 'pri'}>
        <PriorityPanel report={report} onChanged={onDone} />
      </div>
      <div className="tab-panel" role="tabpanel" id="panel-dup" aria-labelledby="tab-dup" hidden={tab !== 'dup'}>
        <DuplicatesPanel report={report} onChanged={onDone} onOpenCount={setOpenDups} onHasContent={setHasDups} />
      </div>
    </div>
  );
}

const ActionDot = () => <span className="tab-dot" aria-label="Action needed" />;

/* ---------- linked as a duplicate ---------- */

function LinkedStage({ report, onDone }: { report: Report; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const main = report.duplicateOf;
  const linkedAt = [...report.logs].reverse().find((l) => (l.remarks ?? '').startsWith('Linked to an earlier report'))?.createdAt;
  const form = report.jobOrderForm;

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/reports/${report.id}/unlink-duplicate`);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="card stage">
      <StageTop step={1} label="Job request">
        <Flag kind="ok">Closed</Flag>
      </StageTop>
      <div className="done-strip" style={{ margin: '6px 0 14px' }}>
        <CheckIcon />
        <span>
          <b>Linked as a duplicate</b> · this report is closed
        </span>
      </div>
      <h2>Handled with the earlier report</h2>
      <p className="lead">
        {linkedAt ? `You marked this as the same problem on ${formatDateTime(linkedAt)}. ` : 'Marked as the same problem as an earlier report. '}
        It needs no job order of its own; the work continues under the earlier report.
      </p>
      {main && (
        <div className="dup-card" style={{ marginTop: 0 }}>
          <div className="dup-top">
            <strong>
              {main.category?.name ?? 'Earlier report'}
              {main.location?.room ? ` · ${main.location.room}` : ''}
            </strong>
            <StatusBadge status={main.status} />
          </div>
          <span className="muted small">
            {[
              main.createdAt && `Reported ${formatDay(main.createdAt)}${main.reporter ? ` by ${main.reporter.fullName}` : ''}`,
              main.jobOrder?.jobOrderNo,
              main.jobOrder?.technician?.fullName,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}
      <dl className="kv">
        <dt>Reporter</dt>
        <dd>
          {report.reporter.fullName} sees “Linked to an earlier report” and gets updates on the repair. They can't open the
          other reporter's report.
        </dd>
        <dt>Job request</dt>
        <dd>
          {form ? (
            <>
              {form.formNo} · <span className="badge f-CLOSED">Closed</span> no job order needed
            </>
          ) : (
            'Not needed'
          )}
        </dd>
      </dl>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <Link className="btn btn-primary" to={`/reports/${report.duplicateOfId}`}>
          Open the earlier report
        </Link>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void unlink()}>
          {busy ? 'Unlinking...' : 'Unlink'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Unlink only if it turns out to be a separate problem. The report reopens as Under review.
      </p>
    </div>
  );
}

/* ---------- steps 3 to 6: the job order ---------- */

// the technician's answer to the current offer
function AnswerFlag({ job }: { job: JobOrder }) {
  if (job.status === 'CANCELLED') return <Flag kind="danger">Cancelled</Flag>;
  if (!job.technicianId) {
    return job.assignmentStatus === 'DECLINED' ? <Flag kind="danger">Declined · reassign</Flag> : <Flag kind="warn">Unassigned</Flag>;
  }
  if (job.assignmentStatus === 'PENDING') return <Flag kind="info">Waiting for reply</Flag>;
  if (job.assignmentStatus === 'ACCEPTED') return <Flag kind="ok">Accepted</Flag>;
  return null;
}

function JobDetails({ job }: { job: JobOrder }) {
  const revised = (job.delays ?? []).find((d) => d.revisedTargetDate)?.revisedTargetDate ?? null;
  return (
    <dl className="kv" style={{ marginTop: 0 }}>
      <dt>Job order</dt>
      <dd>
        <strong>{job.jobOrderNo}</strong>
      </dd>
      <dt>Status</dt>
      <dd>
        <StatusBadge status={job.status} />
      </dd>
      <dt>Trade unit</dt>
      <dd>{job.tradeUnit.name}</dd>
      <dt>Technician</dt>
      <dd>
        {job.technician?.fullName ?? <span className="muted">Not yet assigned</span>} <AnswerFlag job={job} />
      </dd>
      <dt>Materials</dt>
      <dd>{job.materialsNote ?? <span className="muted">Not specified</span>}</dd>
      <dt>Target date</dt>
      <dd>
        {revised ? `${formatDate(revised)} (revised)` : formatDate(job.targetDate)}{' '}
        {isOverdue(job) && <Flag kind="danger">Overdue</Flag>}
      </dd>
      <dt>Created</dt>
      <dd>{formatDateTime(job.createdAt)}</dd>
    </dl>
  );
}

function FormSection({ report }: { report: Report }) {
  const form = report.jobOrderForm;
  if (!form) return null;
  return (
    <div className="section">
      <h3>Job Order Form</h3>
      <FormSummaryRow form={form} line={`Signed by ${report.reporter.fullName} on ${formatDay(form.submittedAt)}`} />
      <div className="btn-row">
        <Link className="btn btn-small" to={`/forms/${form.id}`}>
          Open the form
        </Link>
      </div>
    </div>
  );
}

function jobLead(job: JobOrder): string {
  const who = job.technician?.fullName;
  if (!who) {
    return job.assignmentStatus === 'DECLINED'
      ? 'The technician declined. Choose someone else below.'
      : 'No technician yet. Choose one below.';
  }
  if (job.assignmentStatus === 'PENDING') return `Offered to ${who}. Waiting for them to accept.`;
  return `${who} accepted. Work starts when they begin.`;
}

function JobOrderStage({ report, job, onDone }: { report: Report; job: JobOrder; onDone: () => void }) {
  const needsTech = !job.technicianId;
  return (
    <Stage
      step={3}
      label="Job order"
      tag={needsTech ? <ActionNeeded /> : undefined}
      title={`Job order ${job.jobOrderNo}`}
      lead={jobLead(job)}
    >
      <JobDetails job={job} />
      <ReassignSection job={job} onDone={onDone} />
      <FormSection report={report} />
      <AssignmentHistory job={job} />
      <DelaySection job={job} onDone={onDone} />
    </Stage>
  );
}

function startedAt(report: Report): string | null {
  return report.logs.find((l) => l.oldStatus === 'ASSIGNED' && l.newStatus === 'IN_PROGRESS')?.createdAt ?? null;
}

function InProgressStage({ report, job, onDone }: { report: Report; job: JobOrder; onDone: () => void }) {
  const started = startedAt(report);
  return (
    <Stage
      step={4}
      label="In progress"
      title="Work in progress"
      lead={`${job.technician?.fullName ?? 'The technician'} started${started ? ` on ${formatDateTime(started)}` : ''}. Updates appear in the status history.`}
    >
      <div className="section" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        <h3>Job order details</h3>
        <JobDetails job={job} />
      </div>
      <DelaySection job={job} onDone={onDone} />
    </Stage>
  );
}

function DelayedStage({ report, job, onDone }: { report: Report; job: JobOrder; onDone: () => void }) {
  const d = (job.delays ?? []).find((x) => !x.resolvedAt) ?? null;
  void report;
  return (
    <Stage
      step={4}
      label="In progress"
      tag={<Flag kind="warn">Paused</Flag>}
      title="Waiting on materials"
      lead={
        d
          ? `${d.reportedBy.fullName} paused the job on ${formatDateTime(d.createdAt)}. It resumes when the materials arrive.`
          : 'The job is paused.'
      }
    >
      {d && (
        <>
          <div className="ask">
            <b>Reason:</b> {d.reason}
          </div>
          <dl className="kv">
            <dt>Materials</dt>
            <dd>{d.materialsNote ?? <span className="muted">Not specified</span>}</dd>
            <dt>Revised target</dt>
            <dd>{d.revisedTargetDate ? formatDate(d.revisedTargetDate) : <span className="muted">Not yet set</span>}</dd>
            <dt>Reporter</dt>
            <dd>Told about the delay</dd>
          </dl>
        </>
      )}
      <ResumeControl job={job} onDone={onDone} />
      <div className="section">
        <h3>Job order details</h3>
        <JobDetails job={job} />
      </div>
    </Stage>
  );
}

function VerifyStage({ report, job, onDone }: { report: Report; job: JobOrder; onDone: () => void }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the technician's completion entry: when, what they said, and the photo
  const done = [...report.logs].reverse().find((l) => l.newStatus === 'COMPLETED' && l.oldStatus !== 'COMPLETED');
  const photo = mediaUrl(done?.photoUrl ?? null);

  async function submit(approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/job-orders/${job.id}/verify`, { approved, remarks: remarks.trim() || undefined });
      setRemarks('');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  return (
    <Stage
      step={5}
      label="Completion verification"
      tag={<ActionNeeded />}
      title="Check the finished work"
      lead={`${job.technician?.fullName ?? 'The technician'} marked the job completed${done ? ` on ${formatDateTime(done.createdAt)}` : ''}.`}
    >
      {photo ? (
        <a href={photo} target="_blank" rel="noreferrer">
          <img className="photo-sm" src={photo} alt="Completion photo" />
        </a>
      ) : (
        <div className="photo-sm">No completion photo</div>
      )}
      {done?.remarks && <p className="small" style={{ margin: '10px 0 16px' }}>“{done.remarks}”</p>}
      <label className="field">
        Remarks (required when sending back)
        <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit(true)}>
          Verify and close
        </button>
        <button type="button" className="btn" disabled={busy || remarks.trim().length < 3} onClick={() => void submit(false)}>
          Send back for rework
        </button>
      </div>
      <div className="section">
        <h3>Job order details</h3>
        <JobDetails job={job} />
      </div>
    </Stage>
  );
}

// the quick tags the reporter can tick when rating, stored at the start of the comment
const RATING_TAGS = ['Fast', 'Neat work', 'Friendly', 'Still has issues'];

function splitComment(comment: string | null): { tags: string[]; text: string } {
  if (!comment) return { tags: [], text: '' };
  const m = comment.match(/^([^.]+)\.\s*(.*)$/s);
  if (m) {
    const parts = m[1].split(',').map((s) => s.trim());
    if (parts.length > 0 && parts.every((p) => RATING_TAGS.includes(p))) return { tags: parts, text: m[2] };
  }
  return { tags: [], text: comment };
}

function ClosedStage({ report, job }: { report: Report; job: JobOrder }) {
  const fb = report.feedback;
  const { tags, text } = splitComment(fb?.comment ?? null);
  return (
    <>
      <Stage
        step={6}
        label="Closed"
        tag={<Flag kind="ok">Verified</Flag>}
        title="Reporter feedback"
        lead={
          fb
            ? `${report.reporter.fullName} rated the repair on ${formatDateTime(fb.createdAt)}.`
            : `Verified${job.verifiedAt ? ` on ${formatDateTime(job.verifiedAt)}` : ''}${job.verifiedBy ? ` by ${job.verifiedBy.fullName}` : ''}. Waiting for ${report.reporter.fullName} to rate the repair.`
        }
      >
        {fb && (
          <>
            <div className="stars" role="img" aria-label={`${fb.rating} out of 5`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <svg key={i} viewBox="0 0 24 24" aria-hidden="true" fill={i <= fb.rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                  <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
                </svg>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="chips">
                {tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
            {text && <p style={{ margin: '12px 0 0', color: 'var(--text-2)' }}>“{text}”</p>}
          </>
        )}
      </Stage>
      <Stage
        label="Sign-off"
        title="Job Order sign-off"
        lead="The completed job order with the request, the work done, the verification and the reporter's rating, ready to file."
      >
        <div className="form-row">
          <span className="item-main">
            <strong>{job.jobOrderNo} · sign-off</strong>
            <span className="muted">PDF{job.verifiedAt ? ` · verified ${formatDateTime(job.verifiedAt)}` : ''}</span>
          </span>
        </div>
        <div className="btn-row">
          <PdfButton job={job} primary label="Download sign-off (PDF)" />
        </div>
      </Stage>
    </>
  );
}

/* ---------- technician picker helpers ---------- */

// least busy first, so the coordinator sees who has capacity
function byWorkload(list: Technician[]): Technician[] {
  return [...list].sort((a, b) => a.workload.active - b.workload.active || a.fullName.localeCompare(b.fullName));
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

/* ---------- confirm routing and create the job order ---------- */

function RoutePanel({ report, tradeUnits, onDone }: { report: Report; tradeUnits: TradeUnit[]; onDone: () => void }) {
  const [unitId, setUnitId] = useState(report.proposedTradeUnit.id);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [technicianId, setTechnicianId] = useState('');
  const [materials, setMaterials] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Technician[]>('/job-orders/technicians', { params: { tradeUnitId: unitId } })
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

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/job-orders', {
        reportId: report.id,
        tradeUnitId: unitId,
        technicianId: technicianId || undefined,
        materialsNote: materials.trim() || undefined,
        targetDate: targetDate || undefined,
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        The system proposed <strong>{report.proposedTradeUnit.name}</strong> from the issue category. Keep it or choose another
        trade unit.
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
      {changedUnit && <p className="notice">This will be recorded as a reassignment from {report.proposedTradeUnit.name}.</p>}

      <RecommendationBox reportId={report.id} tradeUnitId={unitId} onRecommend={setTechnicianId} />

      <label className="field">
        Technician
        <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
          <option value="">Assign later</option>
          {byWorkload(technicians).map((t) => (
            <option key={t.id} value={t.id} disabled={isFull(t)}>
              {technicianOption(t)}
            </option>
          ))}
        </select>
      </label>
      {technicians.length === 0 && <p className="muted">No active technicians in this trade unit yet.</p>}

      <label className="field">
        Materials needed (optional)
        <textarea rows={2} value={materials} onChange={(e) => setMaterials(e.target.value)} placeholder="Leave blank if unknown" />
      </label>
      <label className="field">
        Target completion date (optional)
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </label>

      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
          {busy ? 'Working...' : 'Create job order'}
        </button>
      </div>
    </div>
  );
}

/* ---------- change the technician (until work starts) ---------- */

function ReassignSection({ job, onDone }: { job: JobOrder; onDone: () => void }) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [technicianId, setTechnicianId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Technician[]>('/job-orders/technicians', { params: { tradeUnitId: job.tradeUnitId } })
      .then((r) => {
        if (!cancelled) setTechnicians(r.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [job.tradeUnitId]);

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
  const title = job.technician ? 'Change technician' : lastDecline ? 'Reassign to' : 'Assign technician';

  return (
    <div className="section">
      <h3>{title}</h3>
      {lastDecline && !job.technician && (
        <div className="ask" style={{ marginBottom: 10 }}>
          <b>{lastDecline.technician.fullName} declined</b>
          {lastDecline.respondedAt && <> on {formatDateTime(lastDecline.respondedAt)}</>}: “{lastDecline.declineReason}”
        </div>
      )}
      <label className="field" style={{ marginTop: 0 }}>
        <span className="sr-only">Technician</span>
        <select aria-label={title} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
          <option value="">Select technician</option>
          {options.map((t) => (
            <option key={t.id} value={t.id} disabled={isFull(t)}>
              {technicianOption(t)}
              {declinedBy.has(t.id) ? ' · declined this job' : ''}
            </option>
          ))}
        </select>
      </label>
      {options.length === 0 && <p className="muted">No other technicians are available in this trade unit.</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={() => void assign()} disabled={busy || !technicianId}>
          {busy ? 'Saving...' : 'Save technician'}
        </button>
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Available until the technician accepts and starts the job.
      </p>
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
  if (history.length < 2 && !history.some((a) => a.status === 'DECLINED')) return null;
  return (
    <div className="section">
      <h3>Assignment history</h3>
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

/* ---------- material delays ---------- */

async function postJob(job: JobOrder, path: 'delay' | 'resume', body: Record<string, unknown>) {
  await api.post(`/job-orders/${job.id}/${path}`, body);
}

function ResumeControl({ job, onDone }: { job: JobOrder; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="section">
      <h3>Materials arrived?</h3>
      <label className="field" style={{ marginTop: 0 }}>
        Remarks (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Example: materials delivered" />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            postJob(job, 'resume', { remarks: note.trim() || undefined })
              .then(onDone)
              .catch((e: unknown) => {
                setError(errorMessage(e));
                setBusy(false);
              });
          }}
        >
          {busy ? 'Saving...' : 'Resolve delay and resume'}
        </button>
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Usually the technician resumes the job from the app.
      </p>
    </div>
  );
}

function DelaySection({ job, onDone }: { job: JobOrder; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [materials, setMaterials] = useState('');
  const [revisedDate, setRevisedDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const past = (job.delays ?? []).filter((d) => d.resolvedAt);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await postJob(job, 'delay', {
        reason: reason.trim(),
        materialsNote: materials.trim() || undefined,
        revisedTargetDate: revisedDate || undefined,
      });
      setOpen(false);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="section">
      <h3>Material delays</h3>
      {past.length === 0 && !open && <p className="muted small" style={{ margin: '0 0 10px' }}>No delays recorded for this job.</p>}
      {past.map((d) => (
        <div className="delay-item" key={d.id}>
          <strong>{d.reason}</strong>
          <p className="muted">
            {d.materialsNote && `Materials: ${d.materialsNote} · `}
            resolved {formatDateTime(d.resolvedAt!)}
          </p>
        </div>
      ))}
      {!open ? (
        <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
          Record material delay
        </button>
      ) : (
        <div className="delay-form">
          <label className="field">
            Reason for the delay
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Example: waiting for a part from the supplier" />
          </label>
          <label className="field">
            Materials needed (optional)
            <input value={materials} onChange={(e) => setMaterials(e.target.value)} />
          </label>
          <label className="field">
            Revised target date (optional)
            <input type="date" value={revisedDate} onChange={(e) => setRevisedDate(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>
              {busy ? 'Saving...' : 'Save delay notice'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- printable job order ---------- */

// the sign-off PDF, offered only once the job is verified and closed (step 6)
function PdfButton({ job, primary = false, label }: { job: JobOrder; primary?: boolean; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      // fetched through axios so the auth token is sent
      const res = await api.get<Blob>(`/job-orders/${job.id}/pdf`, { responseType: 'blob' });
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
      <button type="button" className={`btn${primary ? ' btn-primary' : ''}`} onClick={() => void download()} disabled={busy}>
        {busy ? 'Preparing PDF...' : label}
      </button>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}
