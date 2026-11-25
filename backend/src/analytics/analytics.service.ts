// Analytics computed from real records only (no sample data). Definitions,
// so every number can be explained:
//
// Reports (coordinator view), filtered by period/category/building/status:
//   submitted      reports created in the period
//   unique problems  of those, not linked as a duplicate of another report
//   pending        Submitted or Under review (no job order yet)
//   ongoing        Assigned, In progress or Delayed
//   completed      Completed (awaiting verification) or Closed (verified)
//   unresolved     not completed yet and older than 7 days
//   completed over time  reports whose work was completed in each period
//                  (the last change to Completed, if still completed/closed)
//   time to assign / complete  from submission to the first job order /
//                  to completion (average and median, hours)
//
// Technicians:
//   offers         job assignments offered in the period, by answer
//                  (accepted / declined / waiting / withdrawn)
//   completed      jobs whose work was completed in the period
//   completion time  from accepting the job to completing it
//   completion rate  of the jobs accepted in the period, the share now
//                  completed
//   active         jobs assigned to them right now (any period)
//   Job orders cancelled as merged duplicates never count (one problem =
//   one job order).

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma, Role, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TechniciansService } from '../technicians/technicians.service';
import {
  OverviewQueryDto,
  RangeQueryDto,
  StatusGroup,
} from './dto/analytics-query.dto';
import {
  ResolvedRange,
  bucketKeys,
  durationStats,
  rate,
  resolveRange,
  series,
} from './analytics-math';

const GROUPS: Record<StatusGroup, Status[]> = {
  pending: [Status.SUBMITTED, Status.UNDER_REVIEW],
  ongoing: [Status.ASSIGNED, Status.IN_PROGRESS, Status.DELAYED],
  completed: [Status.COMPLETED, Status.CLOSED],
};
const DONE: Status[] = GROUPS.completed;
const UNRESOLVED_AFTER_DAYS = 7;

interface JobFact {
  id: string;
  jobOrderNo: string;
  status: Status;
  technicianId: string;
  reportId: string;
  createdAt: Date;
  accepted_at: Date | null;
  completed_at: Date | null;
}

interface ReportFact {
  id: string;
  status: Status;
  createdAt: Date;
  assigned_at: Date | null;
  completed_at: Date | null;
}

const isIn = (d: Date | null, r: ResolvedRange) =>
  !!d && d >= r.from && d < r.to;

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private technicians: TechniciansService,
  ) {}

  // per job order: when its technician accepted it and when work was last
  // completed (cancelled/merged job orders are excluded)
  private jobFacts(technicianId?: string) {
    const onlyTech = technicianId
      ? Prisma.sql`AND jo."technicianId" = ${technicianId}`
      : Prisma.empty;
    return this.prisma.$queryRaw<JobFact[]>`
      SELECT jo.id, jo."jobOrderNo", jo.status, jo."technicianId", jo."reportId", jo."createdAt",
        (SELECT max(ja."respondedAt") FROM "JobAssignment" ja
          WHERE ja."jobOrderId" = jo.id AND ja."technicianId" = jo."technicianId"
            AND ja.status = 'ACCEPTED') AS accepted_at,
        (SELECT max(l."createdAt") FROM "StatusLog" l
          WHERE l."reportId" = jo."reportId" AND l."newStatus" = 'COMPLETED'
            AND l."oldStatus" IS DISTINCT FROM 'COMPLETED') AS completed_at
      FROM "JobOrder" jo
      WHERE jo.status <> 'CANCELLED' AND jo."technicianId" IS NOT NULL ${onlyTech}`;
  }

  // ------------------------------------------------------------ technician

  async technicianStats(
    technicianId: string,
    q: RangeQueryDto,
    viewer: { userId: string; role: Role },
  ) {
    if (viewer.role === Role.TECHNICIAN && viewer.userId !== technicianId) {
      throw new ForbiddenException('You can only see your own performance');
    }
    const tech = await this.prisma.user.findUnique({
      where: { id: technicianId },
      select: {
        id: true,
        fullName: true,
        role: true,
        tradeUnit: { select: { id: true, name: true } },
        technicianRoles: {
          select: { score: true, tradeUnit: { select: { name: true } } },
        },
      },
    });
    if (!tech || tech.role !== Role.TECHNICIAN)
      throw new NotFoundException('Technician not found');

    const r = resolveRange(q.from, q.to);
    const [offers, facts, active, history] = await Promise.all([
      this.prisma.jobAssignment.groupBy({
        by: ['status'],
        where: { technicianId, assignedAt: { gte: r.from, lt: r.to } },
        _count: { _all: true },
      }),
      this.jobFacts(technicianId),
      this.prisma.jobOrder.groupBy({
        by: ['status'],
        where: { technicianId, status: { in: GROUPS.ongoing } },
        _count: { _all: true },
      }),
      this.prisma.jobAssignment.findMany({
        where: { technicianId },
        orderBy: { assignedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          status: true,
          assignedAt: true,
          respondedAt: true,
          declineReason: true,
          jobOrder: {
            select: {
              id: true,
              jobOrderNo: true,
              status: true,
              reportId: true,
              report: {
                select: {
                  priority: true,
                  urgency: true,
                  category: { select: { name: true } },
                  location: {
                    select: { building: true, floor: true, room: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const n = (s: AssignmentStatus) =>
      offers.find((o) => o.status === s)?._count._all ?? 0;
    const completedInRange = facts.filter(
      (f) => DONE.includes(f.status) && isIn(f.completed_at, r),
    );
    const acceptedInRange = facts.filter((f) => isIn(f.accepted_at, r));
    const keys = bucketKeys(r);
    const factById = new Map(facts.map((f) => [f.id, f]));

    return {
      technician: {
        id: tech.id,
        fullName: tech.fullName,
        tradeUnit: tech.tradeUnit,
        roles: tech.technicianRoles.map((x) => ({
          name: x.tradeUnit.name,
          score: x.score,
        })),
      },
      range: { from: r.fromDay, to: r.toDay, granularity: r.granularity },
      offers: {
        total: offers.reduce((s, o) => s + o._count._all, 0),
        accepted: n(AssignmentStatus.ACCEPTED),
        declined: n(AssignmentStatus.DECLINED),
        waiting: n(AssignmentStatus.PENDING),
        withdrawn: n(AssignmentStatus.CANCELLED),
      },
      jobs: {
        completed: completedInRange.length,
        active: active.reduce((s, a) => s + a._count._all, 0),
        activeByStatus: Object.fromEntries(
          active.map((a) => [a.status, a._count._all]),
        ),
        acceptedInPeriod: acceptedInRange.length,
        completionRate: rate(
          acceptedInRange.filter((f) => DONE.includes(f.status)).length,
          acceptedInRange.length,
        ),
        completionTime: durationStats(
          completedInRange.map(
            (f) =>
              f.completed_at!.getTime() -
              (f.accepted_at ?? f.createdAt).getTime(),
          ),
        ),
      },
      series: {
        keys,
        completed: series(
          keys,
          completedInRange.map((f) => f.completed_at!),
          r.granularity,
        ),
        accepted: series(
          keys,
          acceptedInRange.map((f) => f.accepted_at!),
          r.granularity,
        ),
      },
      history: history.map((h) => {
        const f = factById.get(h.jobOrder.id);
        const done = f && DONE.includes(f.status) && f.completed_at;
        return {
          ...h,
          completedAt: done ? f.completed_at : null,
          hoursToComplete:
            done && h.status === AssignmentStatus.ACCEPTED
              ? Math.round(
                  ((f.completed_at!.getTime() -
                    (f.accepted_at ?? f.createdAt).getTime()) /
                    3_600_000) *
                    10,
                ) / 10
              : null,
        };
      }),
    };
  }

  // ------------------------------------------------------------ coordinator

  async overview(q: OverviewQueryDto) {
    const r = resolveRange(q.from, q.to);
    const scope: Prisma.ReportWhereInput = {
      categoryId: q.categoryId,
      location: q.building ? { building: q.building } : undefined,
    };
    const where: Prisma.ReportWhereInput = {
      ...scope,
      createdAt: { gte: r.from, lt: r.to },
      status: q.status ? { in: GROUPS[q.status] } : undefined,
    };

    const catSql = q.categoryId
      ? Prisma.sql`AND r."categoryId" = ${q.categoryId}`
      : Prisma.empty;
    const bldSql = q.building
      ? Prisma.sql`AND loc.building = ${q.building}`
      : Prisma.empty;
    const statusSql = q.status
      ? Prisma.sql`AND r.status::text IN (${Prisma.join(GROUPS[q.status])})`
      : Prisma.empty;

    const [
      byStatus,
      uniqueProblems,
      byCategory,
      byLocation,
      byPriority,
      byUrgency,
      facts,
      unresolved,
      categories,
      buildings,
      techList,
      offers,
      jobFacts,
    ] = await Promise.all([
      this.prisma.report.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.report.count({ where: { ...where, duplicateOfId: null } }),
      this.prisma.report.groupBy({
        by: ['categoryId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.report.groupBy({
        by: ['locationId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.report.groupBy({
        by: ['priority'],
        where,
        _count: { _all: true },
      }),
      this.prisma.report.groupBy({
        by: ['urgency'],
        where,
        _count: { _all: true },
      }),
      // reports submitted in the period, or completed in it (for the trend)
      this.prisma.$queryRaw<ReportFact[]>`
        SELECT r.id, r.status, r."createdAt",
          (SELECT min(l."createdAt") FROM "StatusLog" l
            WHERE l."reportId" = r.id AND l."newStatus" = 'ASSIGNED'
              AND l."oldStatus" IS DISTINCT FROM 'ASSIGNED') AS assigned_at,
          (SELECT max(l."createdAt") FROM "StatusLog" l
            WHERE l."reportId" = r.id AND l."newStatus" = 'COMPLETED'
              AND l."oldStatus" IS DISTINCT FROM 'COMPLETED') AS completed_at
        FROM "Report" r JOIN "Location" loc ON loc.id = r."locationId"
        WHERE TRUE ${catSql} ${bldSql}
          AND ((r."createdAt" >= ${r.from} AND r."createdAt" < ${r.to} ${statusSql})
            OR EXISTS (SELECT 1 FROM "StatusLog" l
              WHERE l."reportId" = r.id AND l."newStatus" = 'COMPLETED'
                AND l."oldStatus" IS DISTINCT FROM 'COMPLETED'
                AND l."createdAt" >= ${r.from} AND l."createdAt" < ${r.to}))`,
      this.prisma.report.count({
        where: {
          ...where,
          status: {
            notIn: DONE,
            ...(q.status ? { in: GROUPS[q.status] } : {}),
          },
          createdAt: {
            gte: r.from,
            lt: new Date(
              Math.min(
                r.to.getTime(),
                Date.now() - UNRESOLVED_AFTER_DAYS * 86_400_000,
              ),
            ),
          },
        },
      }),
      this.prisma.issueCategory.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.findMany({
        distinct: ['building'],
        select: { building: true },
        orderBy: { building: 'asc' },
      }),
      this.technicians.list(),
      this.prisma.jobAssignment.groupBy({
        by: ['technicianId', 'status'],
        where: { assignedAt: { gte: r.from, lt: r.to } },
        _count: { _all: true },
      }),
      this.jobFacts(),
    ]);

    const count = (rows: { _count: { _all: number } }[]) =>
      rows.reduce((s, x) => s + x._count._all, 0);
    const statusN = (list: Status[]) =>
      count(byStatus.filter((s) => list.includes(s.status)));
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const locIds = byLocation.map((l) => l.locationId);
    const locs = await this.prisma.location.findMany({
      where: { id: { in: locIds } },
    });
    const locById = new Map(locs.map((l) => [l.id, l]));
    const perBuilding = new Map<string, number>();
    for (const l of byLocation) {
      const b = locById.get(l.locationId)?.building ?? 'Unknown';
      perBuilding.set(b, (perBuilding.get(b) ?? 0) + l._count._all);
    }

    const submitted = facts.filter(
      (f) => f.createdAt >= r.from && f.createdAt < r.to,
    );
    const submittedInScope = q.status
      ? submitted.filter((f) => GROUPS[q.status!].includes(f.status))
      : submitted;
    const completed = facts.filter(
      (f) => DONE.includes(f.status) && isIn(f.completed_at, r),
    );
    const keys = bucketKeys(r);

    const sortDesc = (
      a: { count: number; label: string },
      b: { count: number; label: string },
    ) => b.count - a.count || a.label.localeCompare(b.label);

    const total = count(byStatus);
    return {
      range: {
        from: r.fromDay,
        to: r.toDay,
        granularity: r.granularity,
        days: r.days,
      },
      filters: {
        categoryId: q.categoryId ?? null,
        building: q.building ?? null,
        status: q.status ?? null,
      },
      totals: {
        submitted: total,
        uniqueProblems,
        pending: statusN(GROUPS.pending),
        ongoing: statusN(GROUPS.ongoing),
        completed: statusN(GROUPS.completed),
        verified: statusN([Status.CLOSED]),
        unresolved,
        unresolvedAfterDays: UNRESOLVED_AFTER_DAYS,
      },
      byStatus: Object.fromEntries(
        byStatus.map((s) => [s.status, s._count._all]),
      ),
      series: {
        keys,
        submitted: series(
          keys,
          submittedInScope.map((f) => f.createdAt),
          r.granularity,
        ),
        completed: series(
          keys,
          completed.map((f) => f.completed_at!),
          r.granularity,
        ),
      },
      byCategory: byCategory
        .map((c) => ({
          id: c.categoryId,
          label: catName.get(c.categoryId) ?? 'Unknown',
          count: c._count._all,
        }))
        .sort(sortDesc),
      byBuilding: [...perBuilding.entries()]
        .map(([label, n]) => ({ label, count: n }))
        .sort(sortDesc),
      topLocations: byLocation
        .map((l) => {
          const loc = locById.get(l.locationId);
          return {
            id: l.locationId,
            label: loc
              ? `${loc.building}, ${loc.floor}, ${loc.room}`
              : 'Unknown',
            count: l._count._all,
          };
        })
        .sort(sortDesc)
        .slice(0, 8),
      byPriority: ['P1', 'P2', 'P3', 'P4', null].map((p) => ({
        label: p ?? 'Not scored',
        count: byPriority.find((x) => x.priority === p)?._count._all ?? 0,
      })),
      byUrgency: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((u) => ({
        label: u,
        count: byUrgency.find((x) => x.urgency === u)?._count._all ?? 0,
      })),
      timing: {
        toAssign: durationStats(
          submittedInScope
            .filter((f) => f.assigned_at)
            .map((f) => f.assigned_at!.getTime() - f.createdAt.getTime()),
        ),
        toComplete: durationStats(
          submittedInScope
            .filter((f) => DONE.includes(f.status) && f.completed_at)
            .map((f) => f.completed_at!.getTime() - f.createdAt.getTime()),
        ),
      },
      technicians: techList
        .map((t) => {
          const mine = jobFacts.filter((f) => f.technicianId === t.id);
          const done = mine.filter(
            (f) => DONE.includes(f.status) && isIn(f.completed_at, r),
          );
          const acc = mine.filter((f) => isIn(f.accepted_at, r));
          const o = (s: AssignmentStatus) =>
            offers.find((x) => x.technicianId === t.id && x.status === s)
              ?._count._all ?? 0;
          const offered = offers
            .filter((x) => x.technicianId === t.id)
            .reduce((s, x) => s + x._count._all, 0);
          return {
            id: t.id,
            fullName: t.fullName,
            tradeUnit: t.tradeUnit?.name ?? null,
            active: t.workload.active,
            delayed: t.workload.delayed,
            offered,
            accepted: o(AssignmentStatus.ACCEPTED),
            declined: o(AssignmentStatus.DECLINED),
            declineRate: rate(
              o(AssignmentStatus.DECLINED),
              o(AssignmentStatus.ACCEPTED) + o(AssignmentStatus.DECLINED),
            ),
            completed: done.length,
            completionRate: rate(
              acc.filter((f) => DONE.includes(f.status)).length,
              acc.length,
            ),
            completionTime: durationStats(
              done.map(
                (f) =>
                  f.completed_at!.getTime() -
                  (f.accepted_at ?? f.createdAt).getTime(),
              ),
            ),
          };
        })
        .sort(
          (a, b) =>
            b.completed - a.completed ||
            b.active - a.active ||
            a.fullName.localeCompare(b.fullName),
        ),
      options: { categories, buildings: buildings.map((b) => b.building) },
    };
  }
}
