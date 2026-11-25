import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { PRIORITY_LABEL } from '../format';
import { useRealtime } from '../socket';
import { ErrorBox, RefreshButton } from '../ui';
import { ChartCard, HBarList, LineChart, SegmentedBar, bucketLabel, formatHours, pct } from '../charts';
import type { AnalyticsOverview, PriorityLevel } from '../types';

// date helpers for the period presets (campus time is close enough to the
// browser's for picking whole days; the server does the exact bucketing)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
const PRESETS = [
  { id: '7', label: 'Last 7 days', from: () => daysAgo(6) },
  { id: '30', label: 'Last 30 days', from: () => daysAgo(29) },
  { id: '90', label: 'Last 90 days', from: () => daysAgo(89) },
  { id: 'year', label: 'This year', from: () => `${new Date().getFullYear()}-01-01` },
];

export function PeriodFilter({
  params,
  setParams,
}: {
  params: URLSearchParams;
  setParams: (p: URLSearchParams) => void;
}) {
  const preset = params.get('period') ?? (params.get('from') ? 'custom' : '30');
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };
  return (
    <>
      <select
        aria-label="Period"
        value={preset}
        onChange={(e) => {
          const p = PRESETS.find((x) => x.id === e.target.value);
          if (p) set({ period: p.id === '30' ? null : p.id, from: null, to: null });
          else set({ period: 'custom', from: params.get('from') ?? daysAgo(29), to: params.get('to') ?? iso(new Date()) });
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range</option>
      </select>
      {preset === 'custom' && (
        <>
          <input
            type="date"
            aria-label="From"
            className="date-input"
            value={params.get('from') ?? ''}
            max={params.get('to') ?? undefined}
            onChange={(e) => set({ from: e.target.value })}
          />
          <input
            type="date"
            aria-label="To"
            className="date-input"
            value={params.get('to') ?? ''}
            min={params.get('from') ?? undefined}
            onChange={(e) => set({ to: e.target.value })}
          />
        </>
      )}
    </>
  );
}

// the from/to query for the API from the URL
export function rangeQuery(params: URLSearchParams): Record<string, string> {
  const preset = params.get('period');
  const p = PRESETS.find((x) => x.id === preset);
  if (p) return { from: p.from(), to: iso(new Date()) };
  if (preset === 'custom' && params.get('from') && params.get('to')) {
    return { from: params.get('from')!, to: params.get('to')! };
  }
  return {}; // server default: last 30 days
}

export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const query = params.toString();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams(query);
    try {
      const res = await api.get<AnalyticsOverview>('/analytics/overview', {
        params: {
          ...rangeQuery(p),
          categoryId: p.get('category') || undefined,
          building: p.get('building') || undefined,
          status: p.get('status') || undefined,
        },
      });
      setData(res.data);
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);
  // figures follow live changes, without reloading on every event burst
  const [stale, setStale] = useState(false);
  useRealtime(() => setStale(true));

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const t = data?.totals;
  const g = data?.range.granularity ?? 'day';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted subtitle">
            {data ? `${bucketLabel(data.range.from, 'day', true)} to ${bucketLabel(data.range.to, 'day', true)}` : ' '}
            {' · '}computed from live records
          </p>
        </div>
        <div className="page-actions">
          {stale && !loading && <span className="muted small">New activity since loading</span>}
          <RefreshButton
            onClick={() => {
              setStale(false);
              void load();
            }}
            loading={loading}
          />
        </div>
      </div>

      {/* filters: one row above the charts */}
      <div className="filters">
        <PeriodFilter params={params} setParams={(p) => setParams(p, { replace: true })} />
        <select aria-label="Category" value={params.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {data?.options.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Building" value={params.get('building') ?? ''} onChange={(e) => set('building', e.target.value)}>
          <option value="">All buildings</option>
          {data?.options.buildings.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
        </select>
        {[...params.keys()].length > 0 && (
          <button className="btn btn-ghost" onClick={() => setParams({}, { replace: true })}>
            Reset
          </button>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {data && t && (
        <>
          <div className="kpis">
            <div className="kpi kpi-hero">
              <span className="kpi-label">Reports submitted</span>
              <strong className="kpi-value">{t.submitted}</strong>
              <span className="kpi-sub">{t.uniqueProblems} unique problems (linked duplicates counted once)</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Pending</span>
              <strong className="kpi-value">{t.pending}</strong>
              <span className="kpi-sub">no job order yet</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Ongoing</span>
              <strong className="kpi-value">{t.ongoing}</strong>
              <span className="kpi-sub">assigned, in progress or delayed</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Completed</span>
              <strong className="kpi-value">{t.completed}</strong>
              <span className="kpi-sub">{t.verified} verified and closed</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Unresolved</span>
              <strong className="kpi-value">{t.unresolved}</strong>
              <span className="kpi-sub">open for more than {t.unresolvedAfterDays} days</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Time to complete</span>
              <strong className="kpi-value">{formatHours(data.timing.toComplete.medianHours)}</strong>
              <span className="kpi-sub">
                median · average {formatHours(data.timing.toComplete.avgHours)} · to first job order{' '}
                {formatHours(data.timing.toAssign.medianHours)}
              </span>
            </div>
          </div>

          <ChartCard
            title="Status of reports submitted in this period"
            table={{
              headers: ['Status', 'Reports'],
              rows: [
                ['Pending', t.pending],
                ['Ongoing', t.ongoing],
                ['Completed', t.completed],
              ],
            }}
          >
            <SegmentedBar
              parts={[
                { label: 'Pending', value: t.pending, slot: 1 },
                { label: 'Ongoing', value: t.ongoing, slot: 2 },
                { label: 'Completed', value: t.completed, slot: 3 },
              ]}
            />
          </ChartCard>

          <ChartCard
            title="Reports over time"
            subtitle={`Submitted vs completed per ${g}`}
            table={{
              headers: [g === 'day' ? 'Day' : g === 'week' ? 'Week of' : 'Month', 'Submitted', 'Completed'],
              rows: data.series.keys.map((k, i) => [bucketLabel(k, g, true), data.series.submitted[i], data.series.completed[i]]),
            }}
          >
            <LineChart
              keys={data.series.keys}
              granularity={g}
              series={[
                { label: 'Submitted', slot: 1, values: data.series.submitted },
                { label: 'Completed', slot: 2, values: data.series.completed },
              ]}
            />
          </ChartCard>

          <div className="grid-2 viz-grid-2">
            <ChartCard
              title="Most common issue types"
              table={{ headers: ['Category', 'Reports'], rows: data.byCategory.map((c) => [c.label, c.count]) }}
            >
              <HBarList items={data.byCategory} />
            </ChartCard>
            <ChartCard
              title="By building"
              table={{ headers: ['Building', 'Reports'], rows: data.byBuilding.map((b) => [b.label, b.count]) }}
            >
              <HBarList items={data.byBuilding} />
            </ChartCard>
            <ChartCard
              title="Most reported rooms"
              subtitle="Top 8 locations"
              table={{ headers: ['Location', 'Reports'], rows: data.topLocations.map((l) => [l.label, l.count]) }}
            >
              <HBarList items={data.topLocations} />
            </ChartCard>
            <ChartCard
              title="By priority"
              subtitle="Computed priority (P1 most important)"
              table={{ headers: ['Priority', 'Reports'], rows: data.byPriority.map((p) => [p.label, p.count]) }}
            >
              <HBarList
                items={data.byPriority.map((p) => ({
                  label: p.label,
                  hint: PRIORITY_LABEL[p.label as PriorityLevel],
                  count: p.count,
                }))}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Technician workload and completion"
            subtitle="Active = assigned to them right now; other columns are for this period"
            wide
          >
            <div className="table-wrap">
              <table className="table table-responsive">
                <thead>
                  <tr>
                    <th>Technician</th>
                    <th className="num">Active now</th>
                    <th className="num">Offered</th>
                    <th className="num">Accepted</th>
                    <th className="num">Declined</th>
                    <th className="num">Completed</th>
                    <th className="num">Completion rate</th>
                    <th className="num">Median time to complete</th>
                  </tr>
                </thead>
                <tbody>
                  {data.technicians.map((x) => (
                    <tr key={x.id}>
                      <td data-label="Technician">
                        <Link to={`/analytics/technicians/${x.id}?${new URLSearchParams(rangeQuery(params)).toString()}`}>
                          <strong>{x.fullName}</strong>
                        </Link>
                        <div className="cell-sub">{x.tradeUnit ?? 'No trade unit'}</div>
                      </td>
                      <td data-label="Active now" className="num">
                        <span>
                          {x.active}
                          {x.delayed > 0 && <span className="cell-sub block">{x.delayed} delayed</span>}
                        </span>
                      </td>
                      <td data-label="Offered" className="num">{x.offered}</td>
                      <td data-label="Accepted" className="num">{x.accepted}</td>
                      <td data-label="Declined" className="num">
                        <span>
                          {x.declined}
                          {x.declineRate !== null && x.declined > 0 && (
                            <span className="cell-sub block">{pct(x.declineRate)} of answers</span>
                          )}
                        </span>
                      </td>
                      <td data-label="Completed" className="num">{x.completed}</td>
                      <td data-label="Completion rate" className="num">{pct(x.completionRate)}</td>
                      <td data-label="Median time" className="num">{formatHours(x.completionTime.medianHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <details className="card definitions">
            <summary>How these numbers are calculated</summary>
            <ul>
              <li>All figures come from the live database for the selected period, in campus time.</li>
              <li><b>Pending</b>: submitted or under review. <b>Ongoing</b>: assigned, in progress or delayed. <b>Completed</b>: completed or verified.</li>
              <li><b>Unresolved</b>: not completed and submitted more than {t.unresolvedAfterDays} days ago.</li>
              <li><b>Completed over time</b> counts reports by the day their work was completed.</li>
              <li><b>Time to complete</b>: from submission to completion. <b>To first job order</b>: from submission to the first job order.</li>
              <li>Technician <b>completion rate</b>: of the jobs they accepted in this period, the share now completed. <b>Time to complete</b> starts when they accepted.</li>
              <li>Job orders cancelled because two reports were the same problem are never counted.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
