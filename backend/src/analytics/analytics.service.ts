import { Injectable } from '@nestjs/common';
import { Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PH_OFFSET = 8 * HOUR; // Asia/Manila is UTC+8 with no daylight saving

type Unit = 'day' | 'week';
type Count = { label: string; count: number };
type Point = { date: string; count: number };

interface LogLite {
  oldStatus: Status | null;
  newStatus: Status;
  createdAt: Date;
}

// the fields needed to score one job order
interface JobLite {
  createdAt: Date;
  targetDate: Date | null;
  status: Status;
  report: {
    logs: LogLite[];
    feedback: { rating: number } | null;
    category: { name: string };
  };
}

const FINISHED: Status[] = [Status.COMPLETED, Status.CLOSED];

// ---------- small helpers ----------

const avg = (nums: number[]): number | null =>
  nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;

const round = (n: number | null, digits = 1): number | null =>
  n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits;

function countBy<T>(items: T[], key: (item: T) => string): Count[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// "2026-11-24" in Manila time; for weeks, the Monday of that week
function localKey(date: Date, unit: Unit): string {
  let t = date.getTime() + PH_OFFSET;
  if (unit === 'week') {
    const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
    t -= dow * DAY;
  }
  return new Date(t).toISOString().slice(0, 10);
}

function bucketKeys(from: Date, to: Date, unit: Unit): string[] {
  const step = unit === 'day' ? DAY : 7 * DAY;
  const keys: string[] = [];
  const end = Date.parse(localKey(to, unit));
  for (let cur = Date.parse(localKey(from, unit)); cur <= end; cur += step) {
    keys.push(new Date(cur).toISOString().slice(0, 10));
  }
  return keys;
}

// counts dates per bucket and fills empty buckets with 0, so charts have no gaps
function series(dates: Date[], from: Date, to: Date, unit: Unit): Point[] {
  const buckets = new Map<string, number>(
    bucketKeys(from, to, unit).map((k) => [k, 0]),
  );
  for (const d of dates) {
    const k = localKey(d, unit);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  return [...buckets].map(([date, count]) => ({ date, count }));
}

// last time the work was marked COMPLETED (a rejected job can be completed again)
const completedAt = (logs: LogLite[]): Date | null =>
  logs.filter((l) => l.newStatus === Status.COMPLETED).pop()?.createdAt ?? null;

// times a coordinator sent the job back for rework
const reworkCount = (logs: LogLite[]): number =>
  logs.filter(
    (l) => l.oldStatus === Status.COMPLETED && l.newStatus === Status.IN_PROGRESS,
  ).length;

// ---------- scoring ----------

function jobMetrics(jobs: JobLite[]) {
  const done = jobs.filter(
    (j) => FINISHED.includes(j.status) && completedAt(j.report.logs),
  );
  const hours = done.map(
    (j) => (completedAt(j.report.logs)!.getTime() - j.createdAt.getTime()) / HOUR,
  );

  // on time = finished on or before the end of the target date (only when one was set)
  const withTarget = done.filter((j) => j.targetDate);
  const onTime = withTarget.filter(
    (j) => completedAt(j.report.logs)!.getTime() <= j.targetDate!.getTime() + DAY,
  ).length;

  const ratings = jobs
    .map((j) => j.report.feedback?.rating)
    .filter((r): r is number => typeof r === 'number');

  const firstTime = done.filter((j) => reworkCount(j.report.logs) === 0).length;

  return {
    assigned: jobs.length,
    active: jobs.filter(
      (j) => j.status === Status.ASSIGNED || j.status === Status.IN_PROGRESS,
    ).length,
    delayed: jobs.filter((j) => j.status === Status.DELAYED).length,
    finished: done.length,
    avgCompletionHours: round(avg(hours)),
    onTimeRate: withTarget.length
      ? round((onTime / withTarget.length) * 100, 0)
      : null,
    onTimeSample: withTarget.length,
    avgRating: round(avg(ratings)),
    ratingCount: ratings.length,
    reworkCount: jobs.reduce((sum, j) => sum + reworkCount(j.report.logs), 0),
    firstTimeApprovalRate: done.length
      ? round((firstTime / done.length) * 100, 0)
      : null,
  };
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  // ---------- technician: own performance ----------
  async technician(userId: string) {
    const jobs = await this.prisma.jobOrder.findMany({
      where: { technicianId: userId },
      include: {
        report: {
          include: {
            category: true,
            feedback: true,
            logs: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    const now = new Date();
    const from = new Date(now.getTime() - 7 * 7 * DAY); // this week + 7 earlier = 8 weeks
    const done = jobs.filter(
      (j) => FINISHED.includes(j.status) && completedAt(j.report.logs),
    );

    return {
      summary: jobMetrics(jobs),
      weekly: series(
        done.map((j) => completedAt(j.report.logs)!),
        from,
        now,
        'week',
      ),
      byCategory: countBy(done, (j) => j.report.category.name).slice(0, 6),
      ratings: [1, 2, 3, 4, 5].map((n) => ({
        label: String(n),
        count: jobs.filter((j) => j.report.feedback?.rating === n).length,
      })),
    };
  }

  // ---------- coordinator / admin: whole campus ----------
  async overview(days?: number) {
    const span = days && days > 0 ? Math.min(days, 730) : null;
    const since = span ? new Date(Date.now() - span * DAY) : null;

    const reports = await this.prisma.report.findMany({
      where: since ? { createdAt: { gte: since } } : undefined,
      include: {
        category: true,
        location: true,
        proposedTradeUnit: true,
        feedback: true,
        logs: { orderBy: { createdAt: 'asc' } },
        jobOrder: {
          include: { technician: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const from = since ?? reports[0]?.createdAt ?? now;
    const unit: Unit = (now.getTime() - from.getTime()) / DAY <= 31 ? 'day' : 'week';

    const finished = reports.filter(
      (r) => FINISHED.includes(r.status) && completedAt(r.logs),
    );
    const resolutionHours = finished.map(
      (r) => (completedAt(r.logs)!.getTime() - r.createdAt.getTime()) / HOUR,
    );
    const ratings = reports
      .map((r) => r.feedback?.rating)
      .filter((v): v is number => typeof v === 'number');

    const overdue = reports.filter(
      (r) =>
        r.jobOrder?.targetDate &&
        !FINISHED.includes(r.jobOrder.status) &&
        r.jobOrder.targetDate.getTime() + DAY < now.getTime(),
    ).length;

    // when are reports filed? (Manila time)
    const weekday = Array<number>(7).fill(0);
    const hour = Array<number>(24).fill(0);
    for (const r of reports) {
      const t = new Date(r.createdAt.getTime() + PH_OFFSET);
      weekday[(t.getUTCDay() + 6) % 7] += 1;
      hour[t.getUTCHours()] += 1;
    }
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // one row per technician
    const byTech = new Map<string, { name: string; jobs: JobLite[] }>();
    for (const r of reports) {
      const job = r.jobOrder;
      if (!job?.technician) continue;
      let entry = byTech.get(job.technician.id);
      if (!entry) {
        entry = { name: job.technician.fullName, jobs: [] };
        byTech.set(job.technician.id, entry);
      }
      entry.jobs.push({
        createdAt: job.createdAt,
        targetDate: job.targetDate,
        status: job.status,
        report: { logs: r.logs, feedback: r.feedback, category: r.category },
      });
    }
    const technicians = [...byTech]
      .map(([technicianId, { name, jobs }]) => ({
        technicianId,
        name,
        ...jobMetrics(jobs),
      }))
      .sort((a, b) => b.finished - a.finished);

    return {
      rangeDays: span,
      unit,
      summary: {
        total: reports.length,
        awaitingAction: reports.filter(
          (r) => r.status === Status.SUBMITTED || r.status === Status.UNDER_REVIEW,
        ).length,
        finished: finished.length,
        avgResolutionHours: round(avg(resolutionHours)),
        overdueJobs: overdue,
        avgRating: round(avg(ratings)),
        ratingCount: ratings.length,
      },
      reportsOverTime: series(reports.map((r) => r.createdAt), from, now, unit),
      resolvedOverTime: series(
        finished.map((r) => completedAt(r.logs)!),
        from,
        now,
        unit,
      ),
      byStatus: Object.values(Status).map((s) => ({
        label: s,
        count: reports.filter((r) => r.status === s).length,
      })),
      byUrgency: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((u) => ({
        label: u,
        count: reports.filter((r) => r.urgency === u).length,
      })),
      byCategory: countBy(reports, (r) => r.category.name),
      byTradeUnit: countBy(reports, (r) => r.proposedTradeUnit.name),
      byBuilding: countBy(reports, (r) => r.location.building),
      topLocations: countBy(
        reports,
        (r) => `${r.location.building}, ${r.location.floor}, ${r.location.room}`,
      ).slice(0, 8),
      byWeekday: dayNames.map((label, i) => ({ label, count: weekday[i] })),
      byHour: hour.map((count, h) => ({ label: String(h), count })),
      technicians,
    };
  }
}