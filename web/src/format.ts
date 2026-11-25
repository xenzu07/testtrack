import type { PriorityLevel, ReviewFlagCode, Status, StatusLog, Urgency } from './types';

export const PRIORITIES: PriorityLevel[] = ['P1', 'P2', 'P3', 'P4'];
export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Medium',
  P4: 'Low',
};
// sort key: unscored reports go last
export const priorityRank = (p: PriorityLevel | null | undefined) => (p ? PRIORITIES.indexOf(p) : 9);

export const REVIEW_FLAG_LABEL: Record<ReviewFlagCode, string> = {
  impact_missing: 'Impact questions were not answered (older app version)',
  possible_duplicate: 'May be the same problem as another report',
};

export const STATUSES: Status[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'DELAYED',
  'COMPLETED',
  'CLOSED',
];
export const URGENCIES: Urgency[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Urgency and priority are one system-set level; signed forms store it as an
// urgency word, shown here as the matching priority.
export const PRIORITY_FROM_URGENCY: Record<Urgency, PriorityLevel> = {
  CRITICAL: 'P1',
  HIGH: 'P2',
  MEDIUM: 'P3',
  LOW: 'P4',
};

export function statusLabel(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function urgencyLabel(u: string): string {
  return u.charAt(0) + u.slice(1).toLowerCase();
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// target dates are stored as UTC midnight, so format them in UTC
export function formatDate(iso: string | null): string {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleDateString('en-PH', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}

export function locationText(l: {
  building: string;
  floor: string;
  room: string;
}): string {
  return `${l.building}, ${l.floor}, ${l.room}`;
}

// a progress update keeps the status at In Progress and adds remarks (and maybe a photo)
export function isProgressUpdate(l: Pick<StatusLog, 'oldStatus' | 'newStatus'>): boolean {
  return l.oldStatus === 'IN_PROGRESS' && l.newStatus === 'IN_PROGRESS';
}
// job order waiting for the coordinator: declined and not yet reassigned
export function isDeclined(j: { status: Status; technicianId: string | null; assignmentStatus?: string | null }): boolean {
  return j.status === 'ASSIGNED' && !j.technicianId && j.assignmentStatus === 'DECLINED';
}

// technician chosen, but has not accepted or declined yet
export function isAwaitingReply(j: { status: Status; technicianId: string | null; assignmentStatus?: string | null }): boolean {
  return j.status === 'ASSIGNED' && Boolean(j.technicianId) && j.assignmentStatus === 'PENDING';
}

// never had a technician
export function isUnassigned(j: { status: Status; technicianId: string | null; assignmentStatus?: string | null }): boolean {
  return j.status === 'ASSIGNED' && !j.technicianId && j.assignmentStatus !== 'DECLINED';
}

// work that is still open (not yet completed by the technician)
export const ACTIVE_JOB_STATUSES: Status[] = ['ASSIGNED', 'IN_PROGRESS', 'DELAYED'];

export const URGENCY_RANK: Record<Urgency, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

// a target date is overdue once that whole day has passed (dates are UTC midnight)
export function isOverdue(j: { targetDate: string | null; status: Status }): boolean {
  if (!j.targetDate || !ACTIVE_JOB_STATUSES.includes(j.status)) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(j.targetDate) < today;
}

// "5 min ago", "3 h ago", "2 days ago", then the date
export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

// the main path a report follows; Delayed is shown as a pause on "In progress"
export const PROGRESS_STEPS: { status: Status; label: string }[] = [
  { status: 'SUBMITTED', label: 'Submitted' },
  { status: 'UNDER_REVIEW', label: 'Under review' },
  { status: 'ASSIGNED', label: 'Assigned' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'COMPLETED', label: 'Completed' },
  { status: 'CLOSED', label: 'Verified' },
];

export function progressIndex(s: Status): number {
  if (s === 'DELAYED') return 3;
  return PROGRESS_STEPS.findIndex((p) => p.status === s);
}

// most recent activity on a report (its last history entry)
export function lastActivity(r: { createdAt: string; logs: StatusLog[] }): string {
  return r.logs.length ? r.logs[r.logs.length - 1].createdAt : r.createdAt;
}
