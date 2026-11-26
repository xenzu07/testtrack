import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import {
  TRIAGE_STATUSES,
  PRIORITY_LABEL,
  isTriageReport,
  lastActivity,
  locationText,
  priorityRank,
  statusLabel,
  timeAgo,
  userTypeLabel,
} from '../format';
import {
  Breadcrumb,
  ErrorBox,
  FilterTabs,
  Flag,
  PriorityBadge,
  QuickFilters,
  RefreshButton,
  StatusBadge,
} from '../ui';
import type { PriorityLevel, Report, ReportOptions, Status } from '../types';
import { useRealtime } from '../socket';

type Sort = 'priority' | 'newest' | 'oldest' | 'activity';
type TriageFlag = '' | 'review' | 'duplicate';

export default function ReportsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [reports, setReports] = useState<Report[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters live in the URL so the Overview tiles can link straight to them
  // and a filtered view can be bookmarked or shared
  const status = (params.get('status') ?? '') as Status | '';
  const priority = (params.get('priority') ?? '') as PriorityLevel | '';
  const categoryId = params.get('category') ?? '';
  const sort = (params.get('sort') ?? 'priority') as Sort;
  const triage = (params.get('flag') ?? '') as TriageFlag;
  const [search, setSearch] = useState(params.get('q') ?? '');

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, o] = await Promise.all([
        api.get<Report[]>('/reports'),
        api.get<ReportOptions>('/reports/options'),
      ]);
      setReports(r.data.filter(isTriageReport));
      setCategories(o.data.categories.map((c) => ({ id: c.id, name: c.name })));
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
    const c = Object.fromEntries(TRIAGE_STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    reports.forEach((r) => {
      c[r.status] += 1;
    });
    return c;
  }, [reports]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = reports.filter(
      (r) =>
        (!status || r.status === status) &&
        (!priority || r.priority === priority) &&
        (!categoryId || r.category.id === categoryId) &&
        (triage !== 'review' || r.needsReview) &&
        (triage !== 'duplicate' || (r._count?.duplicateFlags ?? 0) > 0) &&
        (!q ||
          [
            r.description,
            r.category.name,
            locationText(r.location),
            r.reporter.fullName,
          ].some((v) => v.toLowerCase().includes(q))),
    );
    const by: Record<Sort, (a: Report, b: Report) => number> = {
      // priority, then score, then oldest
      priority: (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        (b.priorityScore ?? -1) - (a.priorityScore ?? -1) ||
        a.createdAt.localeCompare(b.createdAt),
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      activity: (a, b) => lastActivity(b).localeCompare(lastActivity(a)),
    };
    return list.sort(by[sort] ?? by.newest);
  }, [reports, status, priority, categoryId, search, sort, triage]);

  const filtered = Boolean(status || priority || categoryId || search || triage);

  // this page is no longer in the menu: it is reached from the Overview tiles,
  // so it is named after the tile that opened it
  const title =
    triage === 'review'
      ? 'Needs review'
      : triage === 'duplicate'
        ? 'Possible duplicates'
        : status
          ? statusLabel(status)
          : 'Reports';

  return (
    <div>
      <Breadcrumb parent="Overview" to="/overview" current={title} />
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{title}</h1>
          <p className="muted subtitle">
            {shown.length} of {reports.length} report{reports.length === 1 ? '' : 's'}
          </p>
        </div>
        <RefreshButton onClick={() => void load()} loading={loading} />
      </div>

      <FilterTabs
        label="Status"
        value={status}
        onChange={(v) => setParam('status', v)}
        items={[
          { value: '', label: 'All', count: reports.length },
          ...TRIAGE_STATUSES.map((s) => ({ value: s, label: statusLabel(s), count: counts[s] })),
        ]}
      />
      <QuickFilters
        value={triage}
        onChange={(v) => setParam('flag', v)}
        items={[
          { value: 'review', label: 'Priority needs review', count: reports.filter((r) => r.needsReview).length },
          {
            value: 'duplicate',
            label: 'Possible duplicates',
            count: reports.filter((r) => (r._count?.duplicateFlags ?? 0) > 0).length,
          },
        ]}
      />

      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Search reports"
          aria-label="Search description, place or reporter"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setParam('q', e.target.value);
          }}
        />
        <select value={priority} onChange={(e) => setParam('priority', e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {(['P1', 'P2', 'P3', 'P4'] as PriorityLevel[]).map((p) => (
            <option key={p} value={p}>
              {p} {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <select value={categoryId} onChange={(e) => setParam('category', e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setParam('sort', e.target.value === 'priority' ? '' : e.target.value)}
          aria-label="Sort"
        >
          <option value="priority">Highest priority first</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="activity">Recently updated</option>
        </select>
        {filtered && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSearch('');
              setParams(sort === 'priority' ? {} : { sort }, { replace: true });
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {!error && shown.length > 0 && <p className="click-hint">Select a row to open the report.</p>}
      {!error && (
        <div className="card table-wrap">
          <table className="table table-responsive table-clickable">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Issue</th>
                <th>Status</th>
                <th>Reporter</th>
                <th className="num">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => navigate(`/reports/${r.id}`)}
                  className={r.priority === 'P1' ? 'row-critical' : ''}
                >
                  <td data-label="Priority">
                    <span title={r.priorityScore !== null ? `Score ${r.priorityScore} / 100` : undefined}>
                      <PriorityBadge priority={r.priority} />
                    </span>
                  </td>
                  <td data-label="Issue" className="wrap">
                    <Link to={`/reports/${r.id}`} onClick={(e) => e.stopPropagation()}>
                      {r.category.name}
                    </Link>
                    {r.needsReview && <> <Flag kind="warn">Review priority</Flag></>}
                    {(r._count?.duplicateFlags ?? 0) > 0 && <> <Flag kind="danger">Duplicate?</Flag></>}
                    {r.duplicateOfId && <> <Flag kind="info">Linked</Flag></>}
                    <div className="cell-sub">{locationText(r.location)}</div>
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={r.status} />
                  </td>
                  <td data-label="Reporter">
                    {r.reporter.fullName}
                    {r.reporter.userType && <div className="cell-sub">{userTypeLabel(r.reporter.userType)}</div>}
                  </td>
                  <td data-label="Updated" className="num muted">
                    {timeAgo(lastActivity(r))}
                  </td>
                </tr>
              ))}
              {!loading && shown.length === 0 && (
                <tr className="row-empty">
                  <td colSpan={5} className="muted center">
                    {reports.length === 0
                      ? 'No reports are waiting for routing. Reports that became job orders are under Job Orders.'
                      : 'No reports match the current filters.'}
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
