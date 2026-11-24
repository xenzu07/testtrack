import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { formatDate, formatDateTime, locationText } from '../format';
import { ErrorBox, StatusBadge, UrgencyBadge } from '../ui';
import { useRealtime } from '../socket';
import { useAuth } from '../auth';
import { ColumnChart, KpiCard } from '../components/charts';
import type { JobOrder, Report, Urgency } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const URGENCY_RANK: Record<Urgency, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const FINISHED = ['COMPLETED', 'CLOSED'];

interface QueueRow {
  key: string;
  to: string;
  title: string;
  sub: string;
  right: ReactNode;
}

function Queue({
  title,
  hint,
  rows,
  empty,
  tone,
}: {
  title: string;
  hint: string;
  rows: QueueRow[];
  empty: string;
  tone?: 'warn' | 'bad';
}) {
  return (
    <div className={`card queue ${tone ? `queue-${tone}` : ''}`}>
      <div className="queue-head">
        <h3>{title}</h3>
        <span className="queue-count">{rows.length}</span>
      </div>
      <p className="muted queue-hint">{hint}</p>
      {rows.length === 0 && <p className="queue-empty">{empty}</p>}
      <ul className="queue-list">
        {rows.slice(0, 5).map((r) => (
          <li key={r.key}>
            <Link to={r.to}>
              <div>
                <strong>{r.title}</strong>
                <span className="muted">{r.sub}</span>
              </div>
              {r.right}
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > 5 && <p className="muted">+ {rows.length - 5} more</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, j] = await Promise.all([
        api.get<Report[]>('/reports'),
        api.get<JobOrder[]>('/job-orders'),
      ]);
      setReports(r.data);
      setJobs(j.data);
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

  const d = useMemo(() => {
    const now = Date.now();
    const newReports = reports
      .filter((r) => r.status === 'SUBMITTED')
      .sort(
        (a, b) =>
          URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
          +new Date(a.createdAt) - +new Date(b.createdAt),
      );
    const toVerify = jobs.filter((j) => j.status === 'COMPLETED');
    const delayed = jobs.filter((j) => j.status === 'DELAYED');
    const overdue = jobs.filter(
      (j) =>
        j.targetDate &&
        !FINISHED.includes(j.status) &&
        new Date(j.targetDate).getTime() + DAY < now,
    );
    const unassigned = jobs.filter((j) => j.status === 'ASSIGNED' && !j.technicianId);
    const inProgress = jobs.filter((j) => j.status === 'IN_PROGRESS').length;
    const openCritical = reports.filter(
      (r) =>
        (r.urgency === 'CRITICAL' || r.urgency === 'HIGH') && !FINISHED.includes(r.status),
    ).length;

    // reports received per day for the last 7 days (local time)
    const week = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now - (6 - i) * DAY);
      const key = day.toDateString();
      return {
        label: day.toLocaleDateString('en-PH', { weekday: 'short' }),
        value: reports.filter((r) => new Date(r.createdAt).toDateString() === key).length,
      };
    });

    const recent = reports
      .flatMap((r) =>
        r.logs.map((l) => ({ ...l, report: r })),
      )
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 8);

    return { newReports, toVerify, delayed, overdue, unassigned, inProgress, openCritical, week, recent };
  }, [reports, jobs]);

  const reportRow = (r: Report): QueueRow => ({
    key: r.id,
    to: `/reports/${r.id}`,
    title: r.category.name,
    sub: `${locationText(r.location)} · ${formatDateTime(r.createdAt)}`,
    right: <UrgencyBadge urgency={r.urgency} />,
  });

  const jobRow = (j: JobOrder, extra?: string): QueueRow => ({
    key: j.id,
    to: `/reports/${j.reportId}`,
    title: `${j.jobOrderNo} · ${j.report.category.name}`,
    sub: `${j.technician?.fullName ?? 'No technician'}${extra ? ` · ${extra}` : ''}`,
    right: <StatusBadge status={j.status} />,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {user?.fullName.split(' ')[0]}
          </h1>
          <p className="muted">Here is what needs your attention today.</p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {!error && (
        <>
          <div className="kpis">
            <KpiCard
              label="New reports"
              value={d.newReports.length}
              hint="Waiting to be routed"
              tone={d.newReports.length > 0 ? 'warn' : undefined}
            />
            <KpiCard label="In progress" value={d.inProgress} hint="Technicians working" />
            <KpiCard
              label="To verify"
              value={d.toVerify.length}
              hint="Finished, needs sign-off"
              tone={d.toVerify.length > 0 ? 'warn' : undefined}
            />
            <KpiCard
              label="Overdue"
              value={d.overdue.length}
              hint="Past target date"
              tone={d.overdue.length > 0 ? 'warn' : undefined}
            />
            <KpiCard label="High / critical open" value={d.openCritical} />
          </div>

          <div className="grid-2-even">
            <Queue
              title="New reports to route"
              hint="Most urgent first. Confirm the trade unit and create a job order."
              rows={d.newReports.map(reportRow)}
              empty="Nothing waiting. Nice."
              tone={d.newReports.some((r) => r.urgency === 'CRITICAL') ? 'bad' : 'warn'}
            />
            <Queue
              title="Completed, awaiting verification"
              hint="Check the proof photo, then approve or send back."
              rows={d.toVerify.map((j) => jobRow(j))}
              empty="No jobs waiting for verification."
            />
            <Queue
              title="Overdue jobs"
              hint="Target date has passed and the job is not finished."
              rows={d.overdue.map((j) =>
                jobRow(j, `Target ${formatDate(j.targetDate)}`),
              )}
              empty="No overdue jobs."
              tone="bad"
            />
            <Queue
              title="Delayed (materials)"
              hint="Waiting for materials. Resume once they arrive."
              rows={d.delayed.map((j) => jobRow(j))}
              empty="No delayed jobs."
            />
          </div>

          {d.unassigned.length > 0 && (
            <Queue
              title="Job orders without a technician"
              hint="Assign a technician so work can start."
              rows={d.unassigned.map((j) => jobRow(j))}
              empty=""
              tone="warn"
            />
          )}

          <div className="grid-2-even">
            <div className="card chart-card">
              <h3>Reports received, last 7 days</h3>
              <ColumnChart data={d.week} />
              <p className="muted">
                <Link to="/analytics">See full analytics →</Link>
              </p>
            </div>
            <div className="card chart-card">
              <h3>Recent activity</h3>
              <ul className="activity">
                {d.recent.map((a) => (
                  <li key={a.id}>
                    <Link to={`/reports/${a.report.id}`}>
                      <StatusBadge status={a.newStatus} />
                      <span>
                        {a.report.category.name}
                        <small className="muted">
                          {a.remarks ? ` — ${a.remarks}` : ''}
                        </small>
                      </span>
                      <time className="muted">{formatDateTime(a.createdAt)}</time>
                    </Link>
                  </li>
                ))}
                {d.recent.length === 0 && <li className="muted">No activity yet.</li>}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}