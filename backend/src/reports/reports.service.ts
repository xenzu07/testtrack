import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, Role, Status, Urgency } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PhotoStorageService } from '../storage/photo-storage.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { RouteReportDto } from './dto/route-report.dto';
import { EventsGateway } from '../events/events.gateway';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { DuplicatesService } from '../duplicates/duplicates.service';
import { syncLinkedCopies } from '../duplicates/report-links';

// Internal triage data that reporters do not see (their own urgency and
// impact answers stay visible). Removed from every reporter response.
const INTERNAL_FIELDS = [
  'priorityScore',
  'autoPriority',
  'priority',
  'priorityLocked',
  'priorityFactors',
  'reviewFlags',
  'needsReview',
  'reviewedAt',
  'reviewedById',
] as const;

export function forReporter<T extends object | null>(report: T): T {
  if (!report) return report;
  const copy = { ...report } as Record<string, unknown>;
  for (const f of INTERNAL_FIELDS) delete copy[f];
  return copy as T;
}

const reportInclude = {
  category: true,
  location: true,
  proposedTradeUnit: true,
  photos: true,
  reporter: { select: { id: true, fullName: true, userType: true } },
  // the assigned technician's name lets reporters see who is handling it
  jobOrder: {
    include: { technician: { select: { id: true, fullName: true } } },
  },
  // the reporter's signed Job Order Form, if any (summary only)
  jobOrderForm: {
    select: {
      id: true,
      formNo: true,
      status: true,
      revision: true,
      submittedAt: true,
      decisionNote: true,
    },
  },
  // a linked duplicate is handled under the original report's job order
  duplicateOf: {
    select: {
      id: true,
      status: true,
      jobOrder: {
        select: {
          id: true,
          jobOrderNo: true,
          status: true,
          targetDate: true,
          materialsNote: true,
          technician: { select: { id: true, fullName: true } },
        },
      },
    },
  },
  logs: { orderBy: { createdAt: 'asc' } },
  feedback: true,
} satisfies Prisma.ReportInclude;

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private storage: PhotoStorageService,
    private duplicates: DuplicatesService,
  ) {}

  // dropdown data for the mobile report form
  async options() {
    const [categories, locations] = await Promise.all([
      this.prisma.issueCategory.findMany({
        include: { defaultTradeUnit: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.findMany({
        orderBy: [{ building: 'asc' }, { floor: 'asc' }, { room: 'asc' }],
      }),
    ]);
    return { categories, locations, urgencies: Object.values(Urgency) };
  }

  async create(
    userId: string,
    dto: CreateReportDto,
    file: Express.Multer.File,
  ) {
    const category = await this.prisma.issueCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new NotFoundException('Category not found');

    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });
    if (!location) throw new NotFoundException('Location not found');

    // the photo goes to storage first, under the report's own folder; if the
    // database write then fails, the uploaded object is removed again
    const reportId = randomUUID();
    const photoPath = await this.storage.uploadImage(
      file.buffer,
      `reports/${reportId}`,
    );

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const report = await tx.report.create({
          data: {
            id: reportId,
            reporterId: userId,
            locationId: dto.locationId,
            categoryId: dto.categoryId,
            // rule-based routing: category -> default trade unit
            proposedTradeUnitId: category.defaultTradeUnitId,
            description: dto.description,
            urgency: dto.urgency,
            affectedPeople: dto.affectedPeople ?? null,
            safetyHazard: dto.safetyHazard ?? null,
            blocksUse: dto.blocksUse ?? null,
            photos: { create: [{ storageUrl: photoPath }] },
          },
        });

        await tx.statusLog.create({
          data: {
            reportId: report.id,
            newStatus: Status.SUBMITTED,
            remarks: 'Report submitted',
            changedById: userId,
          },
        });

        return tx.report.findUnique({
          where: { id: report.id },
          include: reportInclude,
        });
      });
    } catch (e) {
      await this.storage.removeQuietly(photoPath);
      throw e;
    }

    if (created) {
      this.events.statusChanged(
        {
          reportId: created.id,
          jobOrderId: null,
          status: Status.SUBMITTED,
          message: 'New report submitted',
        },
        [userId],
      );
    }
    if (!created) return created;
    // separate modules: duplicate detection, then priority scoring
    await this.duplicates.analyseNewReport(created.id);
    return forReporter(
      await this.prisma.report.findUnique({
        where: { id: created.id },
        include: reportInclude,
      }),
    );
  }

  // coordinator confirms or changes the proposed trade unit
  async routeReport(id: string, userId: string, dto: RouteReportDto) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { jobOrder: true, proposedTradeUnit: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.jobOrder) {
      throw new BadRequestException(
        'A job order already exists for this report',
      );
    }

    const unit = await this.prisma.tradeUnit.findUnique({
      where: { id: dto.tradeUnitId },
    });
    if (!unit) throw new NotFoundException('Trade unit not found');

    const sameUnit = report.proposedTradeUnitId === unit.id;

    // nothing changed: don't write a duplicate log entry
    if (sameUnit && report.status === Status.UNDER_REVIEW) {
      return this.prisma.report.findUnique({
        where: { id },
        include: reportInclude,
      });
    }

    const note = sameUnit
      ? `Routing to ${unit.name} confirmed`
      : `Reassigned from ${report.proposedTradeUnit.name} to ${unit.name}`;

    let linkedReporters: string[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id },
        data: { proposedTradeUnitId: unit.id, status: Status.UNDER_REVIEW },
      });
      linkedReporters = await syncLinkedCopies(
        tx,
        id,
        Status.UNDER_REVIEW,
        userId,
        note,
      );
      await tx.statusLog.create({
        data: {
          reportId: id,
          oldStatus: report.status,
          newStatus: Status.UNDER_REVIEW,
          remarks: dto.remarks ? `${note}: ${dto.remarks}` : note,
          changedById: userId,
        },
      });
      return tx.report.findUnique({ where: { id }, include: reportInclude });
    });

    this.events.statusChanged(
      {
        reportId: id,
        jobOrderId: null,
        status: Status.UNDER_REVIEW,
        message: note,
      },
      [report.reporterId, ...linkedReporters],
    );
    return updated;
  }

  async findMine(userId: string) {
    const reports = await this.prisma.report.findMany({
      where: { reporterId: userId },
      include: reportInclude,
      orderBy: { createdAt: 'desc' },
    });
    return reports.map(forReporter);
  }

  // coordinators/admins: includes priority and open duplicate flags
  findAll(filters: ListReportsDto) {
    return this.prisma.report.findMany({
      where: {
        status: filters.status,
        urgency: filters.urgency,
        categoryId: filters.categoryId,
      },
      include: {
        ...reportInclude,
        _count: { select: { duplicateFlags: { where: { status: 'OPEN' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: { userId: string; role: Role }) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: reportInclude,
    });
    if (!report) throw new NotFoundException('Report not found');

    const isStaff = user.role === Role.COORDINATOR || user.role === Role.ADMIN;
    if (!isStaff && report.reporterId !== user.userId) {
      throw new ForbiddenException('You cannot view this report');
    }
    return isStaff ? report : forReporter(report);
  }

  async addFeedback(id: string, userId: string, dto: CreateFeedbackDto) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { feedback: true, jobOrder: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.reporterId !== userId) {
      throw new ForbiddenException('You can only rate your own reports');
    }
    if (report.status !== Status.CLOSED) {
      throw new BadRequestException(
        'Feedback can be given once the work is verified and closed',
      );
    }
    if (report.feedback) {
      throw new ConflictException(
        'Feedback was already submitted for this report',
      );
    }

    try {
      await this.prisma.feedback.create({
        data: {
          reportId: id,
          reporterId: userId,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Feedback was already submitted for this report',
        );
      }
      throw e;
    }

    this.events.statusChanged(
      {
        reportId: id,
        jobOrderId: report.jobOrder?.id ?? null,
        status: report.status,
        message: 'Feedback received',
      },
      [userId],
    );
    return forReporter(
      await this.prisma.report.findUnique({
        where: { id },
        include: reportInclude,
      }),
    );
  }
}
