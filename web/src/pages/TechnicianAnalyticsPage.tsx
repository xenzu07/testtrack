import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { formatDateTime, locationText } from "../format";
import { Breadcrumb, ErrorBox, PriorityBadge } from "../ui";
import {
  ChartCard,
  ColumnChart,
  bucketLabel,
  formatHours,
  pct,
} from "../charts";
import { PeriodFilter, rangeQuery } from "./AnalyticsPage";
import type { TechnicianAnalytics } from "../types";

const ANSWER: Record<string, string> = {
  PENDING: "Waiting for reply",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CANCELLED: "Withdrawn",
};

export default function TechnicianAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<TechnicianAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = params.toString();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<TechnicianAnalytics>(
        `/analytics/technicians/${id}`,
        {
          params: rangeQuery(new URLSearchParams(query)),
        },
      );
      setData(res.data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, query]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!data) return <p className="muted">Loading...</p>;
  const g = data.range.granularity;
  const j = data.jobs;

  return (
    <div>
      <Breadcrumb parent="Technicians" to="/technicians" current={data.technician.fullName} />
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{data.technician.fullName}</h1>
          <p className="muted subtitle">
            {data.technician.tradeUnit?.name ?? "No trade unit"}
            {data.technician.roles.length > 0 &&
              ` · survey roles: ${data.technician.roles.map((r) => r.name).join(", ")}`}
            {" · "}
            {bucketLabel(data.range.from, "day", true)} to{" "}
            {bucketLabel(data.range.to, "day", true)}
          </p>
        </div>
      </div>

      <div className="filters">
        <PeriodFilter
          params={params}
          setParams={(p) => setParams(p, { replace: true })}
        />
      </div>

      <div className="kpis">
        <div className="kpi kpi-hero">
          <span className="kpi-label">Jobs completed</span>
          <strong className="kpi-value">{j.completed}</strong>
          <span className="kpi-sub">in this period</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Assigned (offers)</span>
          <strong className="kpi-value">{data.offers.total}</strong>
          <span className="kpi-sub">
            {data.offers.accepted} accepted · {data.offers.declined} declined
            {data.offers.waiting > 0 && ` · ${data.offers.waiting} waiting`}
            {data.offers.withdrawn > 0 &&
              ` · ${data.offers.withdrawn} withdrawn`}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Active now</span>
          <strong className="kpi-value">{j.active}</strong>
          <span className="kpi-sub">pending work, any period</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Completion rate</span>
          <strong className="kpi-value">{pct(j.completionRate)}</strong>
          <span className="kpi-sub">
            of {j.acceptedInPeriod} {j.acceptedInPeriod === 1 ? 'job' : 'jobs'} accepted in this period
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Time to complete</span>
          <strong className="kpi-value">
            {formatHours(j.completionTime.avgHours)}
          </strong>
          <span className="kpi-sub">
            average from acceptance · median{" "}
            {formatHours(j.completionTime.medianHours)}
          </span>
        </div>
      </div>

      <ChartCard
        title="Jobs completed over time"
        subtitle={`Per ${g}; the table view also lists jobs accepted`}
        table={{
          headers: [
            g === "day" ? "Day" : g === "week" ? "Week of" : "Month",
            "Accepted",
            "Completed",
          ],
          rows: data.series.keys.map((k, i) => [
            bucketLabel(k, g, true),
            data.series.accepted[i],
            data.series.completed[i],
          ]),
        }}
      >
        <ColumnChart
          keys={data.series.keys}
          values={data.series.completed}
          label="Jobs completed"
          granularity={g}
        />
      </ChartCard>

      <div className="card">
        <div className="card-head">
          <h2>Job history</h2>
          <span className="muted small">latest 50 assignments, any period</span>
        </div>
        <div className="table-wrap">
          <table className="table table-responsive">
            <thead>
              <tr>
                <th>Job order</th>
                <th>Issue</th>
                <th>Priority</th>
                <th>Answer</th>
                <th>Offered</th>
                <th>Completed</th>
                <th className="num">Time to complete</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td data-label="Job order">
                    <Link to={`/reports/${h.jobOrder.reportId}`}>
                      {h.jobOrder.jobOrderNo}
                    </Link>
                    <div className="cell-sub">
                      {h.jobOrder.status.replace("_", " ").toLowerCase()}
                    </div>
                  </td>
                  <td data-label="Issue">
                    {h.jobOrder.report.category.name}
                    <div className="cell-sub">
                      {locationText(h.jobOrder.report.location)}
                    </div>
                  </td>
                  <td data-label="Priority">
                    <PriorityBadge priority={h.jobOrder.report.priority} />
                  </td>
                  <td data-label="Answer">
                    {ANSWER[h.status] ?? h.status}
                    {h.declineReason && (
                      <div className="cell-sub">“{h.declineReason}”</div>
                    )}
                  </td>
                  <td data-label="Offered">{formatDateTime(h.assignedAt)}</td>
                  <td data-label="Completed">
                    {h.completedAt ? formatDateTime(h.completedAt) : "—"}
                  </td>
                  <td data-label="Time" className="num">
                    {formatHours(h.hoursToComplete)}
                  </td>
                </tr>
              ))}
              {data.history.length === 0 && (
                <tr className="row-empty">
                  <td colSpan={7} className="muted center">
                    No assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
