import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import {
  URGENCY_RANK,
  isAwaitingReply,
  isDeclined,
  isOverdue,
  isUnassigned,
  lastActivity,
  locationText,
  priorityRank,
  timeAgo,
} from '../format';
import { useRealtime } from '../socket';
import { ErrorBox, PriorityBadge, RefreshButton, StatusBadge } from '../ui';
import { WorkloadBar } from './TechniciansPage';
import type { JobOrder, Report, Technician } from '../types';

interface Tile {
  label: string;
  hint: string;
  count: number;
  to: string;
  tone: 'danger' | 'warn' | 'info';
}

// Coordinator home: what needs action now, computed from live records.
export default function OverviewPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, j, t] = await Promise.all([
        api.get<Report[]>('/reports'),
        api.get<JobOrder[]>('/job-orders'),
        api.get<Technician[]>('/job-orders/technicians'),
      ]);
      setReports(r.data);
      setJobs(j.data);
      setTechnicians(t.data);
      setLoadedAt(new Date());
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

  const tiles: Tile[] = useMemo(() => {
    const count = <T,>(list: T[], fn: (x: T) => boolean) => list.filter(fn).length;
    return [
      {
        label: 'Needs review',
        hint: 'Priority looks uncertain',
        count: count(reports, (r) => r.needsReview),
        to: '/reports?flag=review',
        tone: 'warn',
      },
      {
        label: 'Possible duplicates',
        hint: 'Same problem reported again?',
        count: count(reports, (r) => (r._count?.duplicateFlags ?? 0) > 0),
        to: '/reports?flag=duplicate',
        tone: 'danger',
      },
      {
        label: 'New forms',
        hint: 'Signed Job Order Forms to process',
        count: count(reports, (r) => r.jobOrderForm?.status === 'SUBMITTED'),
        to: '/forms?status=SUBMITTED',
        tone: 'info',
      },
      {
        label: 'New reports',
        hint: 'Waiting for routing',
        count: count(reports, (r) => r.status === 'SUBMITTED'),
        to: '/queue',
        tone: 'warn',
      },
      {
        label: 'Under review',
        hint: 'Routed, no job order yet',
        count: count(reports, (r) => r.status === 'UNDER_REVIEW'),
        to: '/reports?status=UNDER_REVIEW',
        tone: 'info',
      },
      {
        label: 'Declined',
        hint: 'Technician said no: reassign',
        count: count(jobs, isDeclined),
        to: '/job-orders?flag=declined',
        tone: 'danger',
      },
      {
        label: 'Awaiting reply',
        hint: 'Technician has not answered yet',
        count: count(jobs, isAwaitingReply),
        to: '/job-orders?flag=pending',
        tone: 'info',
      },
      {
        label: 'Unassigned jobs',
        hint: 'Job order without a technician',
        count: count(jobs, isUnassigned),
        to: '/job-orders?flag=unassigned',
        tone: 'warn',
      },
      {
        label: 'Overdue',
        hint: 'Past the target date',
        count: count(jobs, isOverdue),
        to: '/job-orders?flag=overdue',
        tone: 'danger',
      },
      {
        label: 'Delayed',
        hint: 'Waiting on materials',
        count: count(jobs, (j) => j.status === 'DELAYED'),
        to: '/job-orders?status=DELAYED',
        tone: 'warn',
      },
      {
        label: 'To verify',
        hint: 'Completed, needs your check',
        count: count(jobs, (j) => j.status === 'COMPLETED'),
        to: '/job-orders?status=COMPLETED',
        tone: 'info',
      },
    ];
  }, [reports, jobs]);

  const urgentOpen = useMemo(
    () =>
      reports
        .filter(
          (r) =>
            (r.priority === 'P1' || r.priority === 'P2') &&
            r.status !== 'COMPLETED' &&
            r.status !== 'CLOSED',
        )
        .sort(
          (a, b) =>
            priorityRank(a.priority) - priorityRank(b.priority) ||
            (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
            URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
            a.createdAt.localeCompare(b.createdAt),
        ),
    [reports],
  );

  const recent = useMemo(
    () =>
      [...reports]
        .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
        .slice(0, 6),
    [reports],
  );

  const busiest = useMemo(
    () =>
      [...technicians]
        .sort((a, b) => b.workload.active - a.workload.active || a.fullName.localeCompare(b.fullName))
        .slice(0, 8),
    [technicians],
  );
  const maxActive = Math.max(1, ...technicians.map((t) => t.workload.active));

  if (loading) return <p className="muted">Loading...</p>;

  const pending = tiles.filter((t) => t.count > 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted subtitle">
            {loadedAt && `Updated ${loadedAt.toLocaleTimeString('en-PH', { timeStyle: 'short' })}`}
          </p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="grid-2">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Needs attention</h2>
            </div>
            {pending.length === 0 ? (
              <p className="all-clear">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m8 12 3 3 5-6" />
                </svg>
                Nothing is waiting on you right now.
              </p>
            ) : (
              <ul className="attn">
                {pending.map((t) => (
                  <li key={t.label} className={`attn-${t.tone}`}>
                    <Link to={t.to}>
                      <span className="attn-count">{t.count}</span>
                      <span className="attn-text">
                        <span className="attn-label">{t.label}</span>
                        <span className="attn-hint">{t.hint}</span>
                      </span>
                      <span className="attn-go" aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Open high-priority reports</h2>
              <Link to="/reports">All reports</Link>
            </div>
            {urgentOpen.length === 0 ? (
              <p className="muted">No open P1 or P2 reports.</p>
            ) : (
              <ul className="item-list">
                {urgentOpen.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link to={`/reports/${r.id}`} className="item-link">
                      <span className="item-main">
                        <strong>{r.category.name}</strong>
                        <span className="muted">{locationText(r.location)}</span>
                      </span>
                      <span className="item-side">
                        <StatusBadge status={r.status} />
                        <PriorityBadge priority={r.priority} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Technician workload</h2>
            <Link to="/technicians">All technicians</Link>
          </div>
          {busiest.length === 0 ? (
            <p className="muted">No active technicians.</p>
          ) : (
            <ul className="item-list">
              {busiest.map((t) => (
                <li key={t.id} className="workload-row">
                  <span className="item-main">
                    <strong>{t.fullName}</strong>
                    <span className="muted">{t.tradeUnit?.name ?? 'No trade unit'}</span>
                  </span>
                  <WorkloadBar technician={t} max={maxActive} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Recent activity</h2>
          <Link to="/reports">All reports</Link>
        </div>
        {recent.length === 0 ? (
          <p className="muted">No reports yet.</p>
        ) : (
          <ul className="item-list">
            {recent.map((r) => {
              const last = r.logs[r.logs.length - 1];
              return (
                <li key={r.id}>
                  <Link to={`/reports/${r.id}`} className="item-link">
                    <span className="item-main">
                      <strong>{r.category.name}</strong>
                      <span className="muted">
                        {last?.remarks ?? 'Report submitted'} · {timeAgo(lastActivity(r))}
                      </span>
                    </span>
                    <span className="item-side">
                      <StatusBadge status={r.status} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
