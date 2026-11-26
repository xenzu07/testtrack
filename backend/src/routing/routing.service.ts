import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AssignmentStatus,
  DuplicateStatus,
  Priority,
  Status,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TechniciansService } from '../technicians/technicians.service';
import { rankTechnicians, recommended } from './assignment-recommender';

const PRIORITY_ORDER: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

@Injectable()
export class RoutingService {
  constructor(
    private prisma: PrismaService,
    private technicians: TechniciansService,
  ) {}

  private async declinedIds(reportId: string): Promise<Set<string>> {
    const rows = await this.prisma.jobAssignment.findMany({
      where: { jobOrder: { reportId }, status: AssignmentStatus.DECLINED },
      select: { technicianId: true },
    });
    return new Set(rows.map((r) => r.technicianId));
  }

  // Suggested trade unit (the report's routing) and ranked technicians.
  async recommendation(reportId: string, tradeUnitId?: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        proposedTradeUnit: { select: { id: true, name: true } },
        jobOrder: { select: { tradeUnitId: true } },
      },
    });
    if (!report) throw new NotFoundException('Report not found');

    const unitId =
      tradeUnitId ??
      report.jobOrder?.tradeUnitId ??
      report.proposedTradeUnit.id;
    const unit =
      unitId === report.proposedTradeUnit.id
        ? report.proposedTradeUnit
        : await this.prisma.tradeUnit.findUnique({
            where: { id: unitId },
            select: { id: true, name: true },
          });
    if (!unit) throw new NotFoundException('Trade unit not found');

    const ranked = rankTechnicians(
      await this.technicians.list(unit.id),
      await this.declinedIds(reportId),
    );
    return {
      tradeUnit: unit,
      recommended: recommended(ranked),
      candidates: ranked,
    };
  }

  // Reports waiting for a job order, most important first: effective
  // priority, then score, then oldest. Confirmed duplicates are left out
  // (their original is handled instead) and counted separately.
  async queue() {
    const waiting = { in: [Status.SUBMITTED, Status.UNDER_REVIEW] };
    const [reports, linkedCount] = await Promise.all([
      this.prisma.report.findMany({
        where: { status: waiting, jobOrder: null, duplicateOfId: null },
        select: {
          id: true,
          status: true,
          urgency: true,
          description: true,
          createdAt: true,
          priority: true,
          autoPriority: true,
          priorityScore: true,
          priorityLocked: true,
          reviewFlags: true,
          needsReview: true,
          safetyHazard: true,
          blocksUse: true,
          affectedPeople: true,
          category: { select: { id: true, name: true } },
          location: true,
          proposedTradeUnit: { select: { id: true, name: true } },
          reporter: { select: { id: true, fullName: true, userType: true } },
          _count: {
            select: {
              duplicateFlags: { where: { status: DuplicateStatus.OPEN } },
              duplicates: true,
            },
          },
        },
      }),
      this.prisma.report.count({
        where: {
          status: waiting,
          jobOrder: null,
          duplicateOfId: { not: null },
        },
      }),
    ]);

    reports.sort(
      (a, b) =>
        (a.priority ? PRIORITY_ORDER[a.priority] : 9) -
          (b.priority ? PRIORITY_ORDER[b.priority] : 9) ||
        (b.priorityScore ?? -1) - (a.priorityScore ?? -1) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );

    // one technician lookup per trade unit, not per report
    const byUnit = new Map<
      string,
      Awaited<ReturnType<TechniciansService['list']>>
    >();
    for (const unitId of new Set(reports.map((r) => r.proposedTradeUnit.id))) {
      byUnit.set(unitId, await this.technicians.list(unitId));
    }

    return {
      linkedDuplicatesWaiting: linkedCount,
      items: reports.map((r) => {
        const ranked = rankTechnicians(
          byUnit.get(r.proposedTradeUnit.id) ?? [],
        );
        const top = recommended(ranked);
        const openDuplicateFlags = r._count.duplicateFlags;
        return {
          ...r,
          openDuplicateFlags,
          recommendedTechnician: top,
          // one-click confirmation is only offered when nothing needs a human look
          canAutoConfirm:
            !r.needsReview && openDuplicateFlags === 0 && top !== null,
        };
      }),
    };
  }
}
