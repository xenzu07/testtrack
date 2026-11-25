import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import {
  STATUSES,
  URGENCY_RANK,
  formatDate,
  isAwaitingReply,
  isDeclined,
  isOverdue,
  isUnassigned,
  locationText,
  priorityRank,
  statusLabel,
} from '../format';
import {
  AssignmentFlag,
  ErrorBox,
  FilterTabs,
  Flag,
  PriorityBadge,
  QuickFilters,
  RefreshButton,
  StatusBadge,
} from '../ui';
import type { JobOrder, Status } from '../types';
import { useRealtime } from '../socket';

type QuickFlag = '' | 'overdue' | 'unassigned' | 'declined' | 'pending';
const FLAG_TEST: Record<Exclude<QuickFlag, ''>, (j: JobOrder) => boolean> = {
  overdue: isOverdue,
  unassigned: isUnassigned,
  declined: isDeclined,
  pending: isAwaitingReply,
};
const JOB_STATUSES: Status[] = [
  ...STATUSES.filter((s) => s !== 'SUBMITTED' && s !== 'UNDER_REVIEW'),
  'CANCELLED',
];

export default function JobOrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const status = (params.get('status') ?? '') as Status | '';
  const flag = (params.get('flag') ?? '') as QuickFlag;
  const unitId = params.get('unit') ?? '';
  const [search, setSearch] = useState(params.get('q') ?? '');

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // all job orders are loaded once; filtering happens here so the counts on
  // the status tiles always reflect the full list
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<JobOrder[]>('/job-orders');
      setJobs(res.data);
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

  const counts = useMemo(() => {
    const c = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    jobs.forEach((j) => {
      if (j.status in c) c[j.status] += 1;
    });
    return {
      ...c,
      overdue: jobs.filter(isOverdue).length,
      unassigned: jobs.filter(isUnassigned).length,
      declined: jobs.filter(isDeclined).length,
      pending: jobs.filter(isAwaitingReply).length,
    };
  }, [jobs]);

  const units = useMemo(() => {
    const m = new Map<string, string>();
    jobs.forEach((j) => m.set(j.tradeUnit.id, j.tradeUnit.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [jobs]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs
      .filter(
        (j) =>
          (!status || j.status === status) &&
          (!unitId || j.tradeUnit.id === unitId) &&
          (!flag || FLAG_TEST[flag](j)) &&
          (!q ||
            [
              j.jobOrderNo,
              j.report.category.name,
              locationText(j.report.location),
              j.technician?.fullName ?? '',
            ].some((v) => v.toLowerCase().includes(q))),
      )
      .sort(
        // declined (needs action) and overdue first, then most urgent, then newest
        (a, b) =>
          Number(isDeclined(b)) - Number(isDeclined(a)) ||
          Number(isOverdue(b)) - Number(isOverdue(a)) ||
          priorityRank(a.report.priority) - priorityRank(b.report.priority) ||
          URGENCY_RANK[a.report.urgency] - URGENCY_RANK[b.report.urgency] ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }, [jobs, status, unitId, flag, search]);

  const filtered = Boolean(status || unitId || flag || search);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Job orders</h1>
          <p className="muted subtitle">
            {shown.length} of {jobs.length} job order{jobs.length === 1 ? '' : 's'}, overdue and
            highest priority first
          </p>
        </div>
        <RefreshButton onClick={() => void load()} loading={loading} />
      </div>

      <FilterTabs
        label="Status"
        value={status}
        onChange={(v) => setParam('status', v)}
        items={[
          { value: '', label: 'All', count: jobs.length },
          ...JOB_STATUSES.map((s) => ({ value: s, label: statusLabel(s), count: counts[s] })),
        ]}
      />
      <QuickFilters
        value={flag}
        onChange={(v) => setParam('flag', v)}
        items={[
          { value: 'overdue', label: 'Overdue', count: counts.overdue },
          { value: 'declined', label: 'Declined', count: counts.declined },
          { value: 'unassigned', label: 'No technician', count: counts.unassigned },
          { value: 'pending', label: 'Awaiting reply', count: counts.pending },
        ]}
      />

      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Search job orders"
          aria-label="Search job number, issue, place or technician"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setParam('q', e.target.value);
          }}
        />
        <select value={unitId} onChange={(e) => setParam('unit', e.target.value)}>
          <option value="">All trade units</option>
          {units.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSearch('');
              setParams({}, { replace: true });
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {!error && (
        <div className="card table-wrap">
          <table className="table table-responsive table-clickable">
            <thead>
              <tr>
                <th>Job order</th>
                <th>Issue</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Technician</th>
                <th>Target date</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => {
                const overdue = isOverdue(j);
                return (
                  <tr key={j.id} onClick={() => navigate(`/reports/${j.reportId}`)}>
                    <td data-label="Job order">
                      <Link to={`/reports/${j.reportId}`} onClick={(e) => e.stopPropagation()}>
                        <strong>{j.jobOrderNo}</strong>
                      </Link>
                      <div className="cell-sub">{j.tradeUnit.name}</div>
                    </td>
                    <td data-label="Issue">
                      {j.report.category.name}
                      <div className="cell-sub">{locationText(j.report.location)}</div>
                    </td>
                    <td data-label="Priority">
                      <PriorityBadge priority={j.report.priority} />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={j.status} />
                    </td>
                    <td data-label="Technician">
                      {j.technician?.fullName}
                      <div>
                        <AssignmentFlag job={j} />
                      </div>
                      {isDeclined(j) && j.assignments?.[0]?.declineReason && (
                        <div className="cell-sub">
                          {j.assignments[0].technician.fullName}: “{j.assignments[0].declineReason}”
                        </div>
                      )}
                    </td>
                    <td data-label="Target date">
                      {formatDate(j.targetDate)}
                      {overdue && (
                        <div>
                          <Flag kind="danger">Overdue</Flag>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && shown.length === 0 && (
                <tr className="row-empty">
                  <td colSpan={6} className="muted center">
                    {jobs.length === 0 ? 'No job orders yet.' : 'No job orders match the current filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
