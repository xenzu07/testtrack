import { BadRequestException } from '@nestjs/common';
import { bucketKeys, bucketOf, durationStats, rate, resolveRange, series } from './analytics-math';

describe('resolveRange', () => {
  const now = new Date('2026-11-25T03:00:00Z'); // 11:00 in Manila

  it('defaults to the last 30 local days, by day', () => {
    const r = resolveRange(undefined, undefined, now);
    expect([r.fromDay, r.toDay, r.days, r.granularity]).toEqual(['2026-10-27', '2026-11-25', 30, 'day']);
    // Manila midnight = 16:00 UTC the day before; the end is exclusive
    expect(r.from.toISOString()).toBe('2026-10-26T16:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-25T16:00:00.000Z');
  });

  it('a report just after local midnight belongs to that local day', () => {
    // 2026-11-24T16:30Z = 00:30 on Nov 25 in Manila
    expect(bucketOf(new Date('2026-11-24T16:30:00Z'), 'day')).toBe('2026-11-25');
    expect(bucketOf(new Date('2026-11-24T15:30:00Z'), 'day')).toBe('2026-11-24');
  });

  it('picks weeks and months for longer periods', () => {
    expect(resolveRange('2026-06-01', '2026-11-25', now).granularity).toBe('week');
    expect(resolveRange('2026-01-01', '2026-11-25', now).granularity).toBe('month');
  });

  it('rejects bad or too long periods', () => {
    expect(() => resolveRange('2026-11-30', '2026-11-01', now)).toThrow(BadRequestException);
    expect(() => resolveRange('2025-01-01', '2026-11-25', now)).toThrow(/one year/);
    expect(() => resolveRange('2026-13-45', undefined, now)).toThrow(BadRequestException);
  });
});

describe('buckets and series', () => {
  it('weeks start on Monday and every week appears, even empty ones', () => {
    const r = resolveRange('2026-06-03', '2026-07-01', new Date('2026-11-25T00:00:00Z'));
    const weekly = { ...r, granularity: 'week' as const };
    expect(bucketKeys(weekly)).toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
    const s = series(
      bucketKeys(weekly),
      [new Date('2026-06-03T02:00:00Z'), new Date('2026-06-07T02:00:00Z'), new Date('2026-06-24T02:00:00Z')],
      'week',
    );
    expect(s).toEqual([2, 0, 0, 1, 0]); // Jun 24 is in the week of Jun 22
  });

  it('ignores events outside the buckets', () => {
    const r = resolveRange('2026-11-01', '2026-11-03', new Date('2026-11-25T00:00:00Z'));
    expect(series(bucketKeys(r), [new Date('2026-12-01T00:00:00Z')], 'day')).toEqual([0, 0, 0]);
  });

  it('months', () => {
    const r = resolveRange('2026-01-15', '2026-04-02', new Date('2026-11-25T00:00:00Z'));
    expect(bucketKeys({ ...r, granularity: 'month' })).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  });
});

describe('statistics', () => {
  it('average and median in hours; empty is null, not 0', () => {
    const h = 3_600_000;
    expect(durationStats([1 * h, 2 * h, 9 * h])).toEqual({ count: 3, avgHours: 4, medianHours: 2 });
    expect(durationStats([1 * h, 3 * h])).toEqual({ count: 2, avgHours: 2, medianHours: 2 });
    expect(durationStats([])).toEqual({ count: 0, avgHours: null, medianHours: null });
    expect(durationStats([-5, NaN]).count).toBe(0);
  });

  it('rates', () => {
    expect(rate(2, 3)).toBe(0.667);
    expect(rate(0, 0)).toBeNull();
  });
});
