import type { ReactNode } from 'react';
import type { FormStatus, PriorityLevel, Status, Urgency } from './types';

const FORM_LABEL: Record<FormStatus, string> = {
  SUBMITTED: 'New',
  RECEIVED: 'Received',
  APPROVED: 'Approved',
  RETURNED: 'Returned',
};
export function FormStatusBadge({ status }: { status: FormStatus }) {
  return <span className={`badge f-${status}`}>{FORM_LABEL[status]}</span>;
}
import { PRIORITY_FROM_URGENCY, PRIORITY_LABEL, PROGRESS_STEPS, progressIndex, statusLabel } from './format';

// the system-set priority (P1-P4); urgency is the same level
export function PriorityBadge({ priority }: { priority: PriorityLevel | null | undefined }) {
  if (!priority) return <span className="badge p-none">Not scored</span>;
  return (
    <span className={`badge p-${priority}`} title={`Priority ${priority}: ${PRIORITY_LABEL[priority]}`}>
      {priority} {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge s-${status}`}>{statusLabel(status)}</span>;
}

// a level stored as an urgency word (e.g. on a signed form), shown as priority
export function UrgencyAsPriority({ urgency }: { urgency: Urgency }) {
  return <PriorityBadge priority={PRIORITY_FROM_URGENCY[urgency]} />;
}

// small attention markers next to a status: Overdue, Unassigned, etc.
export type FlagKind = 'danger' | 'warn' | 'info' | 'ok';
export function Flag({ kind, children }: { kind: FlagKind; children: ReactNode }) {
  return <span className={`flag flag-${kind}`}>{children}</span>;
}

// the technician's answer to the current assignment, as a small marker
export function AssignmentFlag({
  job,
}: {
  job: { status: Status; technicianId: string | null; assignmentStatus?: string | null };
}) {
  if (job.status !== 'ASSIGNED') return null;
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

// where a report is on its way from submission to verified repair
export function StatusStepper({ status }: { status: Status }) {
  const current = progressIndex(status);
  const delayed = status === 'DELAYED';
  return (
    <ol className="stepper" aria-label={`Progress: ${statusLabel(status)}`}>
      {PROGRESS_STEPS.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={step.status}
            className={`step step-${state}${delayed && i === current ? ' step-paused' : ''}`}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="step-dot">{i < current ? '✓' : i + 1}</span>
            <span className="step-label">
              {delayed && i === current ? 'Delayed' : step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error">
      <p>{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// Small icon button for pages that also update live; the label shows on hover.
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onClick}
      disabled={loading}
      aria-label="Refresh"
      title="Refresh"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={loading ? 'spin' : undefined}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}

export interface TabItem {
  value: string;
  label: string;
  count?: number;
  alert?: boolean;
}

// Underlined tabs with counts; one of them is always selected ('' = All).
export function FilterTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.value || 'all'}
          role="tab"
          aria-selected={value === t.value}
          className={`tab${value === t.value ? ' tab-active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={`tab-count${t.alert && t.count > 0 ? ' tab-count-alert' : ''}`}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// Toggle chips for "needs action" shortcuts; a chip with nothing to show is hidden.
export function QuickFilters({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange: (v: string) => void;
}) {
  const visible = items.filter((i) => (i.count ?? 0) > 0 || value === i.value);
  if (visible.length === 0) return null;
  return (
    <div className="quick">
      <span className="quick-label">Needs action</span>
      {visible.map((i) => (
        <button
          key={i.value}
          className={`quick-chip${value === i.value ? ' quick-chip-active' : ''}`}
          aria-pressed={value === i.value}
          onClick={() => onChange(value === i.value ? '' : i.value)}
        >
          {i.label} <b>{i.count}</b>
        </button>
      ))}
    </div>
  );
}
