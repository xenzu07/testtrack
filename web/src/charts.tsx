// Small, dependency-free charts for the analytics pages.
// Specs (see the dataviz guidance): thin marks, 2px lines, 4px rounded
// data-ends, >=8px end dots with a 2px surface ring, hairline solid grid,
// one axis, legend for 2+ series, hover tooltip on every chart, and a table
// view for every chart. Colors are role tokens defined in index.css
// (.viz --series-1..3, validated for light and dark separately).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type Granularity = 'day' | 'week' | 'month';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function bucketLabel(key: string, g: Granularity, long = false): string {
  const [y, m, d] = key.split('-').map(Number);
  if (g === 'month') return `${MONTHS[m - 1]} ${y}`;
  const day = `${MONTHS[m - 1]} ${d}`;
  return g === 'week' ? (long ? `Week of ${day}, ${y}` : day) : long ? `${day}, ${y}` : day;
}

// hours -> "12 min", "3.4 h", "2.1 days"
export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

export const pct = (r: number | null | undefined) => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`);

// x labels: every Nth bucket plus the last one, skipping a regular label
// that would sit right next to the last (they would collide)
const showTick = (i: number, n: number, every: number) =>
  i === n - 1 || (i % every === 0 && n - 1 - i >= Math.max(2, Math.ceil(every / 2)));

// clean axis maximum and ticks (integers: these are counts)
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------------------------------------------------------------- card + table view */

export interface TableView {
  headers: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  subtitle,
  table,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  table?: TableView;
  children: ReactNode;
  wide?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card viz ${wide ? 'viz-wide' : ''}`}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small viz-sub">{subtitle}</p>}
        </div>
        {table && (
          <button className="btn btn-ghost btn-small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? 'Show chart' : 'Show as table'}
          </button>
        )}
      </div>
      {asTable && table ? (
        <div className="table-wrap">
          <table className="table viz-table">
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th key={h} className={i > 0 ? 'num' : ''}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j > 0 ? 'num' : ''}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; slot: number }[] }) {
  return (
    <div className="viz-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={`viz-key s${i.slot}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- line chart */

export interface LineSeries {
  label: string;
  slot: 1 | 2 | 3; // categorical slot, fixed per entity
  values: number[];
}

export function LineChart({
  keys,
  series,
  granularity,
  height = 240,
}: {
  keys: string[];
  series: LineSeries[];
  granularity: Granularity;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 16, right: 44, bottom: 28, left: 36 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values)));
  const top = ticks[ticks.length - 1];
  const x = (i: number) => (keys.length <= 1 ? w / 2 : (i / (keys.length - 1)) * w);
  const y = (v: number) => h - (v / top) * h;
  const labelEvery = Math.max(1, Math.ceil(keys.length / Math.max(2, Math.floor(w / 80))));

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = keys.length <= 1 ? 0 : Math.round((px / box.width) * (keys.length - 1));
    setHover(Math.min(keys.length - 1, Math.max(0, i)));
  }

  return (
    <div ref={ref} className="viz-plot">
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, slot: s.slot }))} />}
      <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.label).join(' and ')} over time`}>
        <g transform={`translate(${m.left},${m.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'viz-axis' : 'viz-grid'} x1={0} x2={w} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {keys.map((k, i) =>
            showTick(i, keys.length, labelEvery) ? (
              <text key={k} className="viz-tick" x={x(i)} y={h + 18} textAnchor={i === 0 ? 'start' : i === keys.length - 1 ? 'end' : 'middle'}>
                {bucketLabel(k, granularity)}
              </text>
            ) : null,
          )}
          {series.map((s) => {
            const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
            const area = `${d} L${x(s.values.length - 1)},${h} L${x(0)},${h} Z`;
            const last = s.values.length - 1;
            return (
              <g key={s.label} className={`s${s.slot}`}>
                {series.length === 1 && <path className="viz-area" d={area} />}
                <path className="viz-line" d={d} />
                <circle className="viz-dot" cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} />
                <text className="viz-end" x={x(last) + 8} y={y(s.values[last] ?? 0)} dy="0.32em">
                  {s.values[last] ?? 0}
                </text>
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line className="viz-cross" x1={x(hover)} x2={x(hover)} y1={0} y2={h} />
              {series.map((s) => (
                <circle key={s.label} className={`viz-dot s${s.slot}`} cx={x(hover)} cy={y(s.values[hover])} r={4} />
              ))}
            </g>
          )}
          <rect
            className="viz-hit"
            x={-8}
            y={0}
            width={w + 16}
            height={h}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      </svg>
      {hover !== null && (
        <div
          className="viz-tip"
          style={{ left: Math.min(width - 170, Math.max(0, m.left + x(hover) + 12)), top: 8 }}
          role="status"
        >
          <strong>{bucketLabel(keys[hover], granularity, true)}</strong>
          {series.map((s) => (
            <div key={s.label}>
              <i className={`viz-key s${s.slot}`} />
              {s.label}: <b>{s.values[hover]}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- column chart */

export function ColumnChart({
  keys,
  values,
  label,
  granularity,
  height = 200,
}: {
  keys: string[];
  values: number[];
  label: string;
  granularity: Granularity;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 18, right: 8, bottom: 28, left: 32 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const ticks = niceTicks(Math.max(0, ...values));
  const top = ticks[ticks.length - 1];
  const band = w / Math.max(1, keys.length);
  const barW = Math.min(24, Math.max(3, band - 2)); // <=24px, >=2px gap between bars
  const y = (v: number) => h - (v / top) * h;
  const maxI = values.indexOf(Math.max(...values));
  const labelEvery = Math.max(1, Math.ceil(keys.length / Math.max(2, Math.floor(w / 70))));
  const r = Math.min(4, barW / 2);

  return (
    <div ref={ref} className="viz-plot">
      <svg width={width} height={height} role="img" aria-label={`${label} per ${granularity}`}>
        <g transform={`translate(${m.left},${m.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'viz-axis' : 'viz-grid'} x1={0} x2={w} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {values.map((v, i) => {
            const cx = band * i + band / 2;
            const bh = h - y(v);
            const x0 = cx - barW / 2;
            // rounded data-end, square at the baseline
            const path =
              bh <= 0
                ? ''
                : `M${x0},${h} V${h - bh + Math.min(r, bh)} Q${x0},${h - bh} ${x0 + r},${h - bh} H${x0 + barW - r} Q${x0 + barW},${h - bh} ${x0 + barW},${h - bh + Math.min(r, bh)} V${h} Z`;
            return (
              <g key={keys[i]} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect className="viz-hit" x={band * i} y={0} width={band} height={h} />
                {path && <path className={`viz-bar s1 ${hover === i ? 'is-hover' : ''}`} d={path} />}
                {i === maxI && v > 0 && (
                  <text className="viz-end" x={cx} y={y(v) - 6} textAnchor="middle">
                    {v}
                  </text>
                )}
                {showTick(i, keys.length, labelEvery) && (
                  <text className="viz-tick" x={cx} y={h + 18} textAnchor="middle">
                    {bucketLabel(keys[i], granularity)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hover !== null && (
        <div className="viz-tip" style={{ left: Math.min(width - 160, Math.max(0, m.left + band * hover)), top: 4 }} role="status">
          <strong>{bucketLabel(keys[hover], granularity, true)}</strong>
          <div>
            {label}: <b>{values[hover]}</b>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- horizontal bars */

export function HBarList({
  items,
  unit = 'reports',
  max,
}: {
  items: { label: string; count: number; hint?: string }[];
  unit?: string;
  max?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, max ?? Math.max(0, ...items.map((i) => i.count)));
  const total = items.reduce((s, i) => s + i.count, 0);
  if (items.length === 0) return <p className="muted">No data for this period.</p>;
  return (
    <ul className="viz-hbars">
      {items.map((it, i) => (
        <li
          key={it.label}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          title={`${it.label}: ${it.count} ${unit}${total ? ` (${Math.round((it.count / total) * 100)}%)` : ''}`}
        >
          <span className="viz-hlabel">
            {it.label}
            {it.hint && <span className="muted small"> {it.hint}</span>}
          </span>
          <span className="viz-htrack">
            <span className={`viz-hbar s1 ${hover === i ? 'is-hover' : ''}`} style={{ width: `${(it.count / top) * 100}%` }} />
            <span className="viz-hval">{it.count}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- segmented bar */

export function SegmentedBar({ parts }: { parts: { label: string; value: number; slot: 1 | 2 | 3 }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setHover(null), [total]);
  if (total === 0) return <p className="muted">No reports in this period.</p>;
  return (
    <div className="viz-seg-wrap">
      <div
        className="viz-seg"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${p.value} (${Math.round((p.value / total) * 100)}%)`).join(', ')}
      >
        {parts
          .filter((p) => p.value > 0)
          .map((p, i) => {
            const share = p.value / total;
            return (
              <span
                key={p.label}
                className={`viz-seg-part s${p.slot}`}
                style={{ flexGrow: p.value }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                title={`${p.label}: ${p.value} (${Math.round(share * 100)}%)`}
              >
                {share >= 0.12 && <span className="viz-seg-label">{Math.round(share * 100)}%</span>}
              </span>
            );
          })}
      </div>
      <Legend items={parts.map((p) => ({ label: `${p.label} · ${p.value}`, slot: p.slot }))} />
    </div>
  );
}
