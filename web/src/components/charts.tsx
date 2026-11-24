import type { ReactNode } from 'react';

export interface CountItem {
  label: string;
  count: number;
}
export interface Point {
  date: string; // YYYY-MM-DD
  count: number;
}

// "2026-11-24" -> "Nov 24"
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// 96 -> "4d", 30 -> "1d 6h", 0.5 -> "30 min"
export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '-';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h.toFixed(1)} h`;
  const d = Math.floor(h / 24);
  const rest = Math.round(h - d * 24);
  return rest ? `${d}d ${rest}h` : `${d}d`;
}

export function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'warn' | 'good';
}) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <small className="kpi-hint">{hint}</small>}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="card chart-card">
      <h3>{title}</h3>
      {subtitle && <p className="muted chart-sub">{subtitle}</p>}
      {children}
    </div>
  );
}

// horizontal bars, good for "reports per category"
export function BarList({
  data,
  color = 'var(--green)',
  limit,
}: {
  data: CountItem[];
  color?: string;
  limit?: number;
}) {
  const rows = limit ? data.slice(0, limit) : data;
  const max = Math.max(1, ...rows.map((d) => d.count));
  if (rows.length === 0 || rows.every((d) => d.count === 0)) {
    return <p className="muted">No data for this period.</p>;
  }
  return (
    <div className="barlist">
      {rows.map((d) => (
        <div className="barrow" key={d.label}>
          <span className="barrow-label" title={d.label}>
            {d.label}
          </span>
          <div className="barrow-track">
            <div
              className="barrow-fill"
              style={{ width: `${(d.count / max) * 100}%`, background: color }}
            />
          </div>
          <span className="barrow-count">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

// vertical columns, good for weekday / hour / weekly totals
export function ColumnChart({
  data,
  color = 'var(--green)',
  height = 150,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="cols" style={{ height }}>
      {data.map((d) => (
        <div className="col" key={d.label}>
          <span className="col-val">{d.value > 0 ? d.value : ''}</span>
          <div className="col-track">
            <div
              className="col-bar"
              style={{
                height: d.value > 0 ? `${(d.value / max) * 100}%` : 2,
                background: color,
                opacity: d.value > 0 ? 1 : 0.25,
              }}
            />
          </div>
          <span className="col-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// simple multi-line chart (SVG, no library)
export function LineChart({
  series,
  height = 200,
}: {
  series: { name: string; color: string; points: Point[] }[];
  height?: number;
}) {
  const W = 640;
  const H = height;
  const pad = { l: 32, r: 12, t: 12, b: 24 };
  const n = series[0]?.points.length ?? 0;
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.count)));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v: number) => pad.t + innerH * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max];
  const labelAt = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];

  if (n === 0) return <p className="muted">No data for this period.</p>;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="linechart" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e3e9e3" />
            <text x={pad.l - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#667568">
              {t}
            </text>
          </g>
        ))}
        {labelAt.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            fontSize="11"
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            fill="#667568"
          >
            {shortDate(series[0].points[i].date)}
          </text>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              points={s.points.map((p, i) => `${x(i)},${y(p.count)}`).join(' ')}
            />
            {s.points.map((p, i) => (
              <circle key={p.date} cx={x(i)} cy={y(p.count)} r="3" fill={s.color}>
                <title>{`${s.name}: ${p.count} (${shortDate(p.date)})`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">No ratings yet</span>;
  const full = Math.round(value);
  return (
    <span className="stars-inline" title={`${value} / 5`}>
      {'★'.repeat(full)}
      {'☆'.repeat(5 - full)} <span className="muted">{value}</span>
    </span>
  );
}