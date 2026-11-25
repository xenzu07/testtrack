import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DuplicateStatus, Prisma, Priority, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRIORITY_LABEL, ReviewFlag, scorePriority } from './priority-scoring';

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PriorityService {
  constructor(private prisma: PrismaService) {}

  // Recomputes a report's automatic priority from its current data and
  // stores it. A coordinator's manual priority is kept (priorityLocked).
  // needsReview turns on when a NEW reason for review appears; reasons a
  // coordinator already reviewed do not keep asking again.
  async recalculate(reportId: string, db: Db = this.prisma) {
    const report = await db.report.findUnique({
      where: { id: reportId },
      select: {
        status: true,
        jobOrder: { select: { id: true } },
        urgency: true,
        affectedPeople: true,
        safetyHazard: true,
        blocksUse: true,
        priority: true,
        priorityLocked: true,
        reviewFlags: true,
        needsReview: true,
        category: { select: { severity: true } },
        _count: {
          select: {
            duplicates: true,
            duplicateFlags: { where: { status: DuplicateStatus.OPEN } },
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');

    const result = scorePriority({
      urgency: report.urgency,
      categorySeverity: report.category.severity,
      affectedPeople: report.affectedPeople,
      safetyHazard: report.safetyHazard,
      blocksUse: report.blocksUse,
      corroboratingReports: report._count.duplicates,
    });
    const flags: ReviewFlag[] = [...result.flags];
    if (report._count.duplicateFlags > 0) flags.push('possible_duplicate');

    // Review is only asked for while the report still waits for a job order:
    // that is when the routing decision depends on it. Flags are still stored
    // for later reports (e.g. old reports without impact answers), but they
    // do not fill the coordinator's review list.
    const awaitingRouting =
      (report.status === Status.SUBMITTED ||
        report.status === Status.UNDER_REVIEW) &&
      !report.jobOrder;
    const previous = new Set(report.reviewFlags);
    const hasNewFlag = flags.some((f) => !previous.has(f));
    const needsReview =
      !awaitingRouting || flags.length === 0
        ? false
        : hasNewFlag
          ? true
          : report.needsReview;

    return db.report.update({
      where: { id: reportId },
      data: {
        priorityScore: result.score,
        autoPriority: result.level,
        priority: report.priorityLocked ? report.priority : result.level,
        priorityFactors: result.factors as unknown as Prisma.InputJsonValue,
        reviewFlags: flags,
        needsReview,
      },
      select: {
        id: true,
        priority: true,
        autoPriority: true,
        priorityScore: true,
        needsReview: true,
      },
    });
  }

  // Coordinator checked the automatic result and agrees with it.
  async confirm(reportId: string, userId: string) {
    await this.ensure(reportId);
    return this.prisma.report.update({
      where: { id: reportId },
      data: {
        needsReview: false,
        reviewedAt: new Date(),
        reviewedById: userId,
      },
      select: { id: true, priority: true, needsReview: true },
    });
  }

  // Coordinator sets the priority by hand (reason required and recorded), or
  // returns it to the automatic level (priority = null in the request).
  async adjust(
    reportId: string,
    userId: string,
    to: Priority | null,
    reason: string,
  ) {
    const text = reason.trim();
    if (text.length < 5) {
      throw new BadRequestException(
        'Please give a reason for the change (at least 5 characters)',
      );
    }
    const report = await this.ensure(reportId);
    const target = to ?? report.autoPriority;
    if (!target)
      throw new BadRequestException(
        'This report has no automatic priority yet',
      );
    if (to !== null && report.priorityLocked && report.priority === to) {
      throw new BadRequestException(
        `The priority is already ${to} (${PRIORITY_LABEL[to]})`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.priorityAdjustment.create({
        data: {
          reportId,
          fromPriority: report.priority,
          toPriority: target,
          autoPriority: report.autoPriority,
          reason: to === null ? `Returned to automatic: ${text}` : text,
          adjustedById: userId,
        },
      }),
      this.prisma.report.update({
        where: { id: reportId },
        data: {
          priority: target,
          priorityLocked: to !== null,
          needsReview: false,
          reviewedAt: now,
          reviewedById: userId,
        },
      }),
    ]);
    return this.details(reportId);
  }

  // what coordinators see: breakdown, flags and the change history
  async details(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        priority: true,
        autoPriority: true,
        priorityScore: true,
        priorityLocked: true,
        priorityFactors: true,
        reviewFlags: true,
        needsReview: true,
        reviewedAt: true,
        reviewedBy: { select: { id: true, fullName: true } },
        priorityAdjustments: {
          orderBy: { createdAt: 'desc' },
          include: { adjustedBy: { select: { id: true, fullName: true } } },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  private async ensure(reportId: string) {
    const r = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        priority: true,
        autoPriority: true,
        priorityLocked: true,
      },
    });
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }
}
