import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DuplicateStatus, Prisma, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PriorityService } from '../priority/priority.service';
import { EventsGateway } from '../events/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { linkSameProblem, unlinkReport } from './report-links';
import {
  DuplicateCandidate,
  FLAG_THRESHOLD,
  LIKELY_THRESHOLD,
  similarity,
} from './duplicate-detection';

// only reports from roughly the same period are compared
const LOOKBACK_DAYS = 60;
// matches this close to the best one count as the same problem
const NEAR_BEST = 10;

const summary = {
  id: true,
  status: true,
  description: true,
  urgency: true,
  createdAt: true,
  duplicateOfId: true,
  category: { select: { id: true, name: true } },
  location: true,
  // coordinators only (the duplicates endpoints are not open to reporters)
  reporter: { select: { fullName: true } },
  jobOrder: {
    select: {
      id: true,
      jobOrderNo: true,
      status: true,
      assignmentStatus: true,
      technician: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.ReportSelect;

@Injectable()
export class DuplicatesService {
  private readonly logger = new Logger(DuplicatesService.name);

  constructor(
    private prisma: PrismaService,
    private priority: PriorityService,
    private events: EventsGateway,
    private notifications: NotificationsService,
  ) {}

  private toCandidate(r: {
    id: string;
    categoryId: string;
    locationId: string;
    description: string;
    location: { building: string; floor: string };
  }): DuplicateCandidate {
    return {
      id: r.id,
      categoryId: r.categoryId,
      locationId: r.locationId,
      building: r.location.building,
      floor: r.location.floor,
      description: r.description,
    };
  }

  // Compares a report with earlier open reports nearby or of the same kind.
  // Only ONE report is flagged: the earliest match in the same room, or if
  // none is in the same room, the earliest of the best matches (within
  // NEAR_BEST points of the top score). Several reports of one problem thus
  // point at the first of them, the original it would be handled under,
  // while a report in another room never wins just by being older. Nothing is merged or changed on either report.
  // Returns the number of flags (0 or 1).
  async detectFor(reportId: string): Promise<number> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { location: true },
    });
    if (!report) return 0;

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const others = await this.prisma.report.findMany({
      where: {
        id: { not: reportId },
        status: { not: Status.CLOSED },
        // compare with the original of a known duplicate group, not its copies
        duplicateOfId: null,
        createdAt: { gte: since, lte: report.createdAt },
        OR: [
          { categoryId: report.categoryId },
          { location: { building: report.location.building } },
        ],
      },
      include: { location: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const me = this.toCandidate(report);
    const matches = others
      .map((o) => ({ other: o, ...similarity(me, this.toCandidate(o)) }))
      .filter((m) => m.score >= FLAG_THRESHOLD);
    // a report in the same room is the strongest sign of the same problem;
    // otherwise the matches close to the best score
    const sameRoom = matches.filter((m) => m.other.locationId === report.locationId);
    const best = Math.max(0, ...matches.map((m) => m.score));
    const pool = sameRoom.length > 0 ? sameRoom : matches.filter((m) => m.score >= best - NEAR_BEST);
    const pick = pool
      .sort((a, b) => a.other.createdAt.getTime() - b.other.createdAt.getTime())
      .slice(0, 1);

    for (const m of pick) {
      await this.prisma.duplicateFlag.upsert({
        where: { reportId_candidateId: { reportId, candidateId: m.other.id } },
        // a decision already made is never reopened by detection
        update: {},
        create: {
          reportId,
          candidateId: m.other.id,
          score: m.score,
          reasons: {
            reasons: m.reasons,
            likely: m.score >= LIKELY_THRESHOLD,
          } as Prisma.InputJsonValue,
        },
      });
    }
    return pick.length;
  }

  // flags where this report may copy another, and where others may copy it
  async listFor(reportId: string) {
    const exists = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, duplicateOfId: true },
    });
    if (!exists) throw new NotFoundException('Report not found');

    const include = {
      reviewedBy: { select: { id: true, fullName: true } },
    } satisfies Prisma.DuplicateFlagInclude;
    const [mine, theirs, linked] = await Promise.all([
      this.prisma.duplicateFlag.findMany({
        where: { reportId },
        include: { ...include, candidate: { select: summary } },
        orderBy: { score: 'desc' },
      }),
      this.prisma.duplicateFlag.findMany({
        where: { candidateId: reportId },
        include: { ...include, report: { select: summary } },
        orderBy: { score: 'desc' },
      }),
      this.prisma.report.findMany({
        where: { duplicateOfId: reportId },
        select: summary,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      duplicateOfId: exists.duplicateOfId,
      possibleOriginals: mine,
      possibleCopies: theirs,
      linkedCopies: linked,
    };
  }

  // Coordinator decision on one flag. "confirm" links the two reports as the
  // same problem and leaves ONE job order (see report-links.ts); "dismiss"
  // records that they are different problems. Nothing is ever deleted.
  async decide(
    reportId: string,
    flagId: string,
    userId: string,
    decision: 'confirm' | 'dismiss',
    keepJobOrderId?: string,
  ) {
    const flag = await this.prisma.duplicateFlag.findUnique({
      where: { id: flagId },
      include: {
        report: { select: { createdAt: true } },
        candidate: { select: { createdAt: true } },
      },
    });
    if (
      !flag ||
      (flag.reportId !== reportId && flag.candidateId !== reportId)
    ) {
      throw new NotFoundException('Duplicate flag not found');
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const res = await tx.duplicateFlag.updateMany({
        where: { id: flagId, status: DuplicateStatus.OPEN },
        data: {
          status:
            decision === 'confirm'
              ? DuplicateStatus.CONFIRMED
              : DuplicateStatus.DISMISSED,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
      });
      if (res.count === 0) {
        throw new ConflictException('This flag was already decided');
      }

      let link = null;
      if (decision === 'confirm') {
        const reportIsNewer =
          flag.report.createdAt.getTime() >= flag.candidate.createdAt.getTime();
        link = await linkSameProblem(
          tx,
          reportIsNewer ? flag.candidateId : flag.reportId,
          reportIsNewer ? flag.reportId : flag.candidateId,
          userId,
          keepJobOrderId,
        );
      }
      // both reports' priorities depend on duplicate flags and links
      await this.priority.recalculate(flag.reportId, tx);
      await this.priority.recalculate(flag.candidateId, tx);
      return link;
    });

    if (outcome) {
      if (outcome.cancelledJob?.technicianId) {
        this.events.statusChanged(
          {
            reportId: outcome.cancelledJob.reportId,
            jobOrderId: outcome.cancelledJob.id,
            status: Status.CANCELLED,
            message: `${outcome.cancelledJob.jobOrderNo} was merged into ${outcome.keptJobOrderNo}: same problem, no separate work needed`,
            kind: 'assignment.withdrawn',
            technicianId: outcome.cancelledJob.technicianId,
          },
          [outcome.cancelledJob.technicianId],
        );
      }
      this.events.statusChanged(
        {
          reportId: outcome.copyReportId,
          jobOrderId: null,
          status: Status.SUBMITTED,
          message: 'Report linked to an earlier report of the same problem',
        },
        outcome.reporterIds,
      );
      this.notifications.emit({
        type: 'report.linked',
        reportId: outcome.copyReportId,
        actorId: userId,
        reporterIds: outcome.reporterIds,
        cancelledJob: outcome.cancelledJob ?? null,
        keptJobOrderNo: outcome.keptJobOrderNo,
      });
    }
    return this.listFor(reportId);
  }

  // undo a confirmed link (the flag is marked dismissed); a job order that
  // was cancelled by the merge is reopened without a technician
  async unlink(reportId: string, userId: string) {
    const original = await this.prisma.$transaction(async (tx) => {
      const main = await unlinkReport(tx, reportId, userId);
      await tx.duplicateFlag.updateMany({
        where: {
          status: DuplicateStatus.CONFIRMED,
          OR: [
            { reportId, candidateId: main },
            { reportId: main, candidateId: reportId },
          ],
        },
        data: {
          status: DuplicateStatus.DISMISSED,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
      });
      await this.priority.recalculate(reportId, tx);
      await this.priority.recalculate(main, tx);
      return main;
    });
    this.events.statusChanged(
      {
        reportId,
        jobOrderId: null,
        status: Status.UNDER_REVIEW,
        message: 'Report unlinked from the other report',
      },
      [],
    );
    void original;
    return this.listFor(reportId);
  }

  // used after a report is created: detection then scoring; a failure here
  // must never lose the report itself
  async analyseNewReport(reportId: string) {
    try {
      await this.detectFor(reportId);
    } catch (e) {
      this.logger.error(
        `Duplicate detection failed for ${reportId}: ${String(e)}`,
      );
    }
    try {
      await this.priority.recalculate(reportId);
    } catch (e) {
      this.logger.error(
        `Priority scoring failed for ${reportId}: ${String(e)}`,
      );
    }
  }
}
