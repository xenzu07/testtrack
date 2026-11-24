import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { statusLabel, urgencyLabel } from '../format';
import { ErrorBox } from '../ui';
import { useRealtime } from '../socket';
import type { AnalyticsOverview } from '../types';
import {
  BarList,
  ChartCard,
  ColumnChart,
  KpiCard,
  LineChart,
  Stars,
  formatHours,
} from '../components/charts';

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
  { value: 0, label: 'All time' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<AnalyticsOverview>('/analytics/overview', {
        params: days ? { days } : undefined,
      });
      setData(res.data);
    } catch (e) {
      setError(errorMessage(e));
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(() => {
    void load();
  });

  const s = data?.summary;
  const bucket = data?.unit === 'week' ? 'week' : 'day';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Report frequency, hotspots, and repair performance.</p>
        </div>
        <div className="filters" style={{ marginBottom: 0 }}>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {data && s && (
        <>
          <div className="kpis">
            <KpiCard label="Reports received" value={s.total} />
            <KpiCard
              label="Awaiting action"
              value={s.awaitingAction}
              hint="Submitted or under review"
              tone={s.awaitingAction > 0 ? 'warn' : undefined}
            />
            <KpiCard label="Repairs finished" value={s.finished} tone="good" />
            <KpiCard
              label="Avg. time to finish"
              value={formatHours(s.avgResolutionHours)}
              hint="Report submitted to work completed"
            />
            <KpiCard
              label="Overdue jobs"
              value={s.overdueJobs}
              hint="Past target date, not finished"
              tone={s.overdueJobs > 0 ? 'warn' : undefined}
            />
            <KpiCard
              label="Satisfaction"
              value={<Stars value={s.avgRating} />}
              hint={`${s.ratingCount} rating${s.ratingCount === 1 ? '' : 's'}`}
            />
          </div>

          <ChartCard
            title="Reports received vs. repairs finished"
            subtitle={`Per ${bucket}${bucket === 'week' ? ' (week starting Monday)' : ''}`}
          >
            <LineChart
              series={[
                { name: 'Received', color: '#1b5e20', points: data.reportsOverTime },
                { name: 'Finished', color: '#1565c0', points: data.resolvedOverTime },
              ]}
            />
          </ChartCard>

          <div className="grid-3">
            <ChartCard title="Reports by category" subtitle="What breaks most often">
              <BarList data={data.byCategory} />
            </ChartCard>
            <ChartCard title="Reports by building" subtitle="Where problems are reported">
              <BarList data={data.byBuilding} color="#1565c0" />
            </ChartCard>
            <ChartCard title="Workload by trade unit">
              <BarList data={data.byTradeUnit} color="#8a5a00" />
            </ChartCard>
          </div>

          <div className="grid-3">
            <ChartCard title="Hotspot locations" subtitle="Top rooms by number of reports">
              <BarList data={data.topLocations} color="#b71c1c" />
            </ChartCard>
            <ChartCard title="By urgency">
              <BarList
                data={data.byUrgency.map((d) => ({ ...d, label: urgencyLabel(d.label) }))}
                color="#e65100"
              />
            </ChartCard>
            <ChartCard title="By current status">
              <BarList
                data={data.byStatus.map((d) => ({ ...d, label: statusLabel(d.label) }))}
                color="#6a1b9a"
              />
            </ChartCard>
          </div>

          <div className="grid-2-even">
            <ChartCard title="Reports by day of week" subtitle="Manila time">
              <ColumnChart
                data={data.byWeekday.map((d) => ({ label: d.label, value: d.count }))}
              />
            </ChartCard>
            <ChartCard title="Reports by hour of day" subtitle="Manila time, 0 = midnight">
              <ColumnChart
                height={150}
                data={data.byHour.map((d) => ({
                  label: Number(d.label) % 3 === 0 ? d.label : '',
                  value: d.count,
                }))}
              />
            </ChartCard>
          </div>

          <div className="card table-wrap">
            <h3 style={{ padding: '16px 16px 0' }}>Technician performance</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Technician</th>
                  <th>Jobs</th>
                  <th>Active</th>
                  <th>Delayed</th>
                  <th>Finished</th>
                  <th>Avg. time</th>
                  <th>On time</th>
                  <th>First-time approval</th>
                  <th>Rework</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {data.technicians.map((t) => (
                  <tr key={t.technicianId}>
                    <td>{t.name}</td>
                    <td>{t.assigned}</td>
                    <td>{t.active}</td>
                    <td>{t.delayed}</td>
                    <td>{t.finished}</td>
                    <td>{formatHours(t.avgCompletionHours)}</td>
                    <td>
                      {t.onTimeRate === null
                        ? '-'
                        : `${t.onTimeRate}% (${t.onTimeSample})`}
                    </td>
                    <td>
                      {t.firstTimeApprovalRate === null
                        ? '-'
                        : `${t.firstTimeApprovalRate}%`}
                    </td>
                    <td>{t.reworkCount}</td>
                    <td>
                      <Stars value={t.avgRating} />
                    </td>
                  </tr>
                ))}
                {data.technicians.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted center">
                      No job orders in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted">
            On time = finished by the job order's target date (only counted when a target
            date was set, number of jobs in brackets). Rework = completed work that was
            sent back by the coordinator.
          </p>
        </>
      )}
    </div>
  );
}