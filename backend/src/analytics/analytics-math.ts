// Date ranges, time buckets and summary statistics for analytics.
// Pure functions (no database). All dates are bucketed in campus time
// (Asia/Manila, UTC+8, no daylight saving).

import { BadRequestException } from '@nestjs/common';

export const TZ = 'Asia/Manila';
const OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

export type Granularity = 'day' | 'week' | 'month';

export interface ResolvedRange {
  from: Date; // inclusive, UTC instant of local midnight
  to: Date; // exclusive, UTC instant of the local midnight after the last day
  fromDay: string; // YYYY-MM-DD (local)
  toDay: string; // YYYY-MM-DD (local, inclusive)
  days: number;
  granularity: Granularity;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// local calendar day (as a UTC-midnight Date) for an instant
const localDay = (instant: Date) =>
  new Date(Math.floor((instant.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS);

function parseDay(s: string, name: string): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  ) {
    throw new BadRequestException(`${name} must be a date like 2026-11-25`);
  }
  return new Date(`${s}T00:00:00Z`);
}

// Defaults to the last 30 days including today. At most 366 days.
export function resolveRange(
  from?: string,
  to?: string,
  now = new Date(),
): ResolvedRange {
  const today = localDay(now);
  const toD = to ? parseDay(to, 'to') : today;
  const fromD = from
    ? parseDay(from, 'from')
    : new Date(toD.getTime() - 29 * DAY_MS);
  if (fromD > toD)
    throw new BadRequestException('"from" must be on or before "to"');
  const days = Math.round((toD.getTime() - fromD.getTime()) / DAY_MS) + 1;
  if (days > 366)
    throw new BadRequestException('Choose a period of one year or less');
  return {
    from: new Date(fromD.getTime() - OFFSET_MS),
    to: new Date(toD.getTime() + DAY_MS - OFFSET_MS),
    fromDay: ymd(fromD),
    toDay: ymd(toD),
    days,
    granularity: days <= 45 ? 'day' : days <= 200 ? 'week' : 'month',
  };
}

// start of the bucket a local day belongs to (weeks start on Monday)
export function bucketStart(day: Date, g: Granularity): Date {
  if (g === 'day') return day;
  if (g === 'month')
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - dow * DAY_MS);
}

// every bucket key from the start to the end of the range, so periods with
// no activity show as 0 instead of disappearing
export function bucketKeys(r: ResolvedRange): string[] {
  const keys: string[] = [];
  const last = parseDay(r.toDay, 'to');
  let cur = bucketStart(parseDay(r.fromDay, 'from'), r.granularity);
  while (cur <= last) {
    keys.push(ymd(cur));
    cur =
      r.granularity === 'day'
        ? new Date(cur.getTime() + DAY_MS)
        : r.granularity === 'week'
          ? new Date(cur.getTime() + 7 * DAY_MS)
          : new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return keys;
}

export function bucketOf(instant: Date, g: Granularity): string {
  return ymd(bucketStart(localDay(instant), g));
}

// counts per bucket, in key order (missing buckets are 0)
export function series(
  keys: string[],
  instants: Date[],
  g: Granularity,
): number[] {
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const t of instants) {
    const k = bucketOf(t, g);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return keys.map((k) => counts.get(k)!);
}

export interface DurationStats {
  count: number;
  avgHours: number | null;
  medianHours: number | null;
}

export function durationStats(ms: number[]): DurationStats {
  const valid = ms
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  if (valid.length === 0)
    return { count: 0, avgHours: null, medianHours: null };
  const h = (x: number) => Math.round((x / 3_600_000) * 10) / 10;
  const mid = Math.floor(valid.length / 2);
  const median =
    valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return {
    count: valid.length,
    avgHours: h(valid.reduce((a, b) => a + b, 0) / valid.length),
    medianHours: h(median),
  };
}

// share 0..1 rounded to 3 decimals, or null when there is nothing to divide
export const rate = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null;
