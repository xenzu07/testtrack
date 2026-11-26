import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma, Role, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhotoStorageService } from '../storage/photo-storage.service';
import { TechniciansService, jobLimitError } from '../technicians/technicians.service';
import { syncLinkedCopies } from '../duplicates/report-links';
import { CreateJobOrderDto } from './dto/create-job-order.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { AssignTechnicianDto } from './dto/assign-technician.dto';
import { EventsGateway } from '../events/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AddProgressDto } from './dto/add-progress.dto';
import { ReportDelayDto } from './dto/report-delay.dto';
import { ResumeJobDto } from './dto/resume-job.dto';
import { VerifyJobDto } from './dto/verify-job.dto';
import { buildJobOrderPdf } from './job-order-pdf';
import { MAX_ACTIVE_JOBS } from '../routing/assignment-recommender';

export const jobInclude = {
  tradeUnit: true,
  mergedInto: { select: { id: true, jobOrderNo: true, reportId: true } },
  technician: { select: { id: true, fullName: true } },
  verifiedBy: { select: { id: true, fullName: true } },
  delays: {
    orderBy: { createdAt: 'desc' },
    include: { reportedBy: { select: { id: true, fullName: true } } },
  },
  report: {
    include: {
      category: true,
      location: true,
      photos: true,
      feedback: true,
      reporter: { select: { id: true, fullName: true, userType: true } },
      logs: { orderBy: { createdAt: 'asc' } },
    },
  },
} satisfies Prisma.JobOrderInclude;

export type JobOrderFull = Prisma.JobOrderGetPayload<{
  include: typeof jobInclude;
}>;

// assignment history: only for coordinators/admins, because decline reasons
// are internal and must not reach reporters
const assignmentHistory = {
  orderBy: { assignedAt: 'desc' },
  include: {
    technician: { select: { id: true, fullName: true } },
    assignedBy: { select: { id: true, fullName: true } },
  },
} satisfies Prisma.JobOrder$assignmentsArgs;

const NEXT_STATUS: Partial<Record<Status, Status[]>> = {
  [Status.ASSIGNED]: [Status.IN_PROGRESS],
  [Status.IN_PROGRESS]: [Status.COMPLETED],
};

@Injectable()
export class JobOrdersService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private storage: PhotoStorageService,
    private technicians: TechniciansService,
    private notifications: NotificationsService,
  ) {}

  // work photos are stored next to the report's own photos
  private uploadWorkPhoto(reportId: string, file?: Express.Multer.File) {
    return file
      ? this.storage.uploadImage(file.buffer, `reports/${reportId}/work`)
      : Promise.resolve(null);
  }

  private async assertTechnician(technicianId: string, tradeUnitId: string) {
    const tech = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });
    if (!tech || tech.role !== Role.TECHNICIAN || !tech.isActive) {
      throw new BadRequestException('Technician not found or inactive');
    }
    // assigned trade unit, or a role earned through the skills survey
    if (!(await this.technicians.isQualified(tech.id, tradeUnitId))) {
      throw new BadRequestException(
        'Technician is not qualified for the selected trade unit',
      );
    }
    await this.technicians.assertHasRoom(tech);
    return tech;
  }

  // kept for the existing dashboard route; the list now also includes
  // technicians qualified for the trade unit through the skills survey
  listTechnicians(tradeUnitId?: string) {
    return this.technicians.list(tradeUnitId);
  }

  async create(userId: string, dto: CreateJobOrderDto) {
    const report = await this.prisma.report.findUnique({
      where: { id: dto.reportId },
      include: { jobOrder: true, proposedTradeUnit: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.jobOrder) {
      throw new ConflictException('A job order already exists for this report');
    }
    // one problem = one job order: a linked duplicate is handled under the
    // job order of the report it is linked to
    if (report.duplicateOfId) {
      throw new BadRequestException(
        'This report is linked to another report of the same problem and is handled under its job order. Unlink it first if it really needs separate work.',
      );
    }
    if (
      report.status !== Status.SUBMITTED &&
      report.status !== Status.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        'This report can no longer receive a job order',
      );
    }

    const tradeUnitId = dto.tradeUnitId ?? report.proposedTradeUnitId;
    const unit = await this.prisma.tradeUnit.findUnique({
      where: { id: tradeUnitId },
    });
    if (!unit) throw new NotFoundException('Trade unit not found');

    const changedUnit = unit.id !== report.proposedTradeUnitId;

    const tech = dto.technicianId
      ? await this.assertTechnician(dto.technicianId, unit.id)
      : null;

    let linkedReporters: string[] = [];
    // retry if two coordinators generate a number at the same moment
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const prefix = `JO-${new Date().getFullYear()}-`;
          const last = await tx.jobOrder.findFirst({
            where: { jobOrderNo: { startsWith: prefix } },
            orderBy: { jobOrderNo: 'desc' },
          });
          const next = last
            ? parseInt(last.jobOrderNo.slice(prefix.length), 10) + 1
            : 1;
          const jobOrderNo = `${prefix}${String(next).padStart(4, '0')}`;

          const job = await tx.jobOrder.create({
            data: {
              jobOrderNo,
              reportId: report.id,
              tradeUnitId: unit.id,
              technicianId: tech?.id ?? null,
              // the technician must accept before starting work
              assignmentStatus: tech ? AssignmentStatus.PENDING : null,
              materialsNote: dto.materialsNote ?? null,
              targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
              createdById: userId,
            },
          });
          if (tech) {
            // checked again here so two jobs created at once cannot pass the
            // limit; the count already includes the job just created
            if ((await this.technicians.activeJobCount(tech.id, tx)) > MAX_ACTIVE_JOBS) {
              throw jobLimitError(tech.fullName);
            }
            await tx.jobAssignment.create({
              data: {
                jobOrderId: job.id,
                technicianId: tech.id,
                assignedById: userId,
              },
            });
          }

          // routing is confirmed or changed as part of generating the job order
          await tx.report.update({
            where: { id: report.id },
            data: { status: Status.ASSIGNED, proposedTradeUnitId: unit.id },
          });
          linkedReporters = await syncLinkedCopies(
            tx,
            report.id,
            Status.ASSIGNED,
            userId,
            `job order ${jobOrderNo} created`,
          );

          // explicit timestamps keep the two entries in the right order
          let clock = Date.now();
          let previous: Status = report.status;

          if (report.status === Status.SUBMITTED || changedUnit) {
            const note = changedUnit
              ? `Reassigned from ${report.proposedTradeUnit.name} to ${unit.name}`
              : `Routing to ${unit.name} confirmed`;
            await tx.statusLog.create({
              data: {
                reportId: report.id,
                oldStatus: report.status,
                newStatus: Status.UNDER_REVIEW,
                remarks: dto.routingRemarks
                  ? `${note}: ${dto.routingRemarks}`
                  : note,
                changedById: userId,
                createdAt: new Date(clock),
              },
            });
            previous = Status.UNDER_REVIEW;
            clock += 1;
          }

          await tx.statusLog.create({
            data: {
              reportId: report.id,
              oldStatus: previous,
              newStatus: Status.ASSIGNED,
              remarks:
                `Job order ${jobOrderNo} created for ${unit.name}` +
                (tech ? `, assigned to ${tech.fullName}` : ''),
              changedById: userId,
              createdAt: new Date(clock),
            },
          });

          return tx.jobOrder.findUnique({
            where: { id: job.id },
            include: jobInclude,
          });
        });

        if (created) {
          this.events.statusChanged(
            {
              reportId: report.id,
              jobOrderId: created.id,
              status: Status.ASSIGNED,
              message: tech
                ? `New job ${created.jobOrderNo} assigned to you`
                : `Job order ${created.jobOrderNo} created`,
              ...(tech
                ? { kind: 'assignment.offered' as const, technicianId: tech.id }
                : {}),
            },
            [report.reporterId, tech?.id, ...linkedReporters],
          );
          this.notifications.emit({
            type: 'job.created',
            reportId: report.id,
            jobOrderId: created.id,
            actorId: userId,
            technicianId: tech?.id ?? null,
          });
        }
        return created;
      } catch (e) {
        const isCollision =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002';
        if (!isCollision || attempt === 2) throw e;
      }
    }
    throw new ConflictException(
      'Could not generate a job order number, try again',
    );
  }

  // coordinators/admins only (see controller). A job order cancelled because
  // its report was the same problem as another is left out: the work
  // continues under the kept job order, which is listed.
  findAll(status?: Status) {
    return this.prisma.jobOrder.findMany({
      where: status ? { status } : { status: { not: Status.CANCELLED } },
      include: { ...jobInclude, assignments: assignmentHistory },
      orderBy: { createdAt: 'desc' },
    });
  }

  // cancelled duplicates are left out, as in findAll
  findAssigned(technicianId: string) {
    return this.prisma.jobOrder.findMany({
      where: { technicianId, status: { not: Status.CANCELLED } },
      include: jobInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: { userId: string; role: Role }) {
    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: jobInclude,
    });
    if (!job) throw new NotFoundException('Job order not found');

    const isStaff = user.role === Role.COORDINATOR || user.role === Role.ADMIN;
    const isOwnTechnician =
      user.role === Role.TECHNICIAN && job.technicianId === user.userId;
    const isOwnReporter =
      user.role === Role.REPORTER && job.report.reporterId === user.userId;

    if (!isStaff && !isOwnTechnician && !isOwnReporter) {
      throw new ForbiddenException('You cannot view this job order');
    }
    if (!isStaff) return job;
    const assignments = await this.prisma.jobAssignment.findMany({
      where: { jobOrderId: id },
      ...assignmentHistory,
    });
    return { ...job, assignments };
  }

  async assignTechnician(id: string, userId: string, dto: AssignTechnicianDto) {
    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: {
        technician: { select: { id: true, fullName: true } },
        report: { select: { reporterId: true } },
      },
    });
    if (!job) throw new NotFoundException('Job order not found');
    if (job.status !== Status.ASSIGNED) {
      throw new BadRequestException(
        'Technician can only be changed before work starts',
      );
    }
    if (job.technicianId === dto.technicianId) {
      throw new BadRequestException(
        'This technician is already assigned to the job',
      );
    }
    const previousId = job.technicianId;
    const tech = await this.assertTechnician(dto.technicianId, job.tradeUnitId);

    const remarks = job.technician
      ? `Technician reassigned from ${job.technician.fullName} to ${tech.fullName}`
      : `Technician assigned: ${tech.fullName}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      // only while work has not started (checked again inside the transaction)
      const moved = await tx.jobOrder.updateMany({
        where: { id, status: Status.ASSIGNED, technicianId: previousId },
        data: {
          technicianId: tech.id,
          assignmentStatus: AssignmentStatus.PENDING,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException(
          'This job changed meanwhile. Reload and try again.',
        );
      }
      // counted after the move, so this job itself is included
      if ((await this.technicians.activeJobCount(tech.id, tx)) > MAX_ACTIVE_JOBS) {
        throw jobLimitError(tech.fullName);
      }
      // an offer still waiting, or already accepted, by someone else is withdrawn
      await tx.jobAssignment.updateMany({
        where: {
          jobOrderId: id,
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
        },
        data: { status: AssignmentStatus.CANCELLED, respondedAt: new Date() },
      });
      await tx.jobAssignment.create({
        data: { jobOrderId: id, technicianId: tech.id, assignedById: userId },
      });
      await tx.statusLog.create({
        data: {
          reportId: job.reportId,
          oldStatus: Status.ASSIGNED,
          newStatus: Status.ASSIGNED,
          remarks,
          changedById: userId,
        },
      });
      return tx.jobOrder.findUnique({
        where: { id },
        include: { ...jobInclude, assignments: assignmentHistory },
      });
    });

    this.events.statusChanged(
      {
        reportId: job.reportId,
        jobOrderId: id,
        status: Status.ASSIGNED,
        message: `New job ${job.jobOrderNo} assigned to you`,
        kind: 'assignment.offered',
        technicianId: tech.id,
      },
      [job.report.reporterId, tech.id],
    );
    this.notifications.emit({
      type: 'job.reassigned',
      reportId: job.reportId,
      jobOrderId: id,
      actorId: userId,
      technicianId: tech.id,
      previousTechnicianId: previousId,
    });
    // the previous technician is told, so the job leaves their list
    if (previousId) {
      this.events.statusChanged(
        {
          reportId: job.reportId,
          jobOrderId: id,
          status: Status.ASSIGNED,
          message: `${job.jobOrderNo} was reassigned to another technician`,
          kind: 'assignment.withdrawn',
          technicianId: previousId,
        },
        [previousId],
      );
    }
    return updated;
  }

  // The assigned technician accepts or declines. The update only succeeds
  // while the offer is still PENDING for this technician, so a double tap,
  // a second device, or a coordinator reassigning at the same moment can
  // never record two answers.
  async respond(id: string, userId: string, accept: boolean, reason?: string) {
    const declineReason = reason?.trim() ?? '';
    if (!accept && declineReason.length < 5) {
      throw new BadRequestException(
        'Please give a reason for declining (at least 5 characters)',
      );
    }

    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: { report: { select: { reporterId: true } } },
    });
    if (!job) throw new NotFoundException('Job order not found');
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.jobOrder.updateMany({
        where: {
          id,
          technicianId: userId,
          status: Status.ASSIGNED,
          assignmentStatus: AssignmentStatus.PENDING,
        },
        data: accept
          ? { assignmentStatus: AssignmentStatus.ACCEPTED }
          : { assignmentStatus: AssignmentStatus.DECLINED, technicianId: null },
      });
      if (res.count === 0) {
        const mine = await tx.jobAssignment.findFirst({
          where: { jobOrderId: id, technicianId: userId },
          orderBy: { assignedAt: 'desc' },
          select: { status: true },
        });
        if (mine?.status === AssignmentStatus.DECLINED) {
          throw new ConflictException('You already declined this job');
        }
        if (job.technicianId !== userId) {
          throw new ForbiddenException('This job is no longer assigned to you');
        }
        throw new ConflictException(
          job.assignmentStatus === AssignmentStatus.ACCEPTED
            ? 'You already accepted this job'
            : 'You already answered this assignment',
        );
      }
      await tx.jobAssignment.updateMany({
        where: {
          jobOrderId: id,
          technicianId: userId,
          status: AssignmentStatus.PENDING,
        },
        data: accept
          ? { status: AssignmentStatus.ACCEPTED, respondedAt: new Date() }
          : {
              status: AssignmentStatus.DECLINED,
              declineReason,
              respondedAt: new Date(),
            },
      });
      // the reporter sees progress, never the internal decline reason
      await tx.statusLog.create({
        data: {
          reportId: job.reportId,
          oldStatus: Status.ASSIGNED,
          newStatus: Status.ASSIGNED,
          remarks: accept
            ? `${me?.fullName ?? 'The technician'} accepted the job`
            : 'The technician is not available. Another technician will be assigned.',
          changedById: userId,
        },
      });
      return tx.jobOrder.findUnique({ where: { id }, include: jobInclude });
    });

    const name = me?.fullName ?? 'The technician';
    this.events.statusChanged(
      {
        reportId: job.reportId,
        jobOrderId: id,
        status: Status.ASSIGNED,
        message: accept
          ? `${name} accepted ${job.jobOrderNo}`
          : `${name} declined ${job.jobOrderNo}: ${declineReason}`,
        kind: accept ? 'assignment.accepted' : 'assignment.declined',
        technicianId: userId,
      },
      // the reporter is only told when work is confirmed
      accept ? [job.report.reporterId, userId] : [userId],
    );
    this.notifications.emit({
      type: 'job.answered',
      reportId: job.reportId,
      jobOrderId: id,
      technicianId: userId,
      accepted: accept,
      reason: declineReason,
    });
    return updated;
  }

  async updateStatus(
    id: string,
    userId: string,
    dto: UpdateJobStatusDto,
    file?: Express.Multer.File,
  ) {
    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: { report: { select: { reporterId: true } } },
    });
    if (!job) throw new NotFoundException('Job order not found');
    if (job.technicianId !== userId) {
      throw new ForbiddenException('This job is not assigned to you');
    }

    if (
      job.status === Status.ASSIGNED &&
      job.assignmentStatus !== AssignmentStatus.ACCEPTED
    ) {
      throw new BadRequestException('Accept the job before starting work');
    }

    const allowed = NEXT_STATUS[job.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change status from ${job.status} to ${dto.status}`,
      );
    }

    // proof of work: completing a job requires a photo
    if (dto.status === Status.COMPLETED && !file) {
      throw new BadRequestException(
        'A photo of the completed work is required',
      );
    }

    const photoUrl = await this.uploadWorkPhoto(job.reportId, file);

    let linkedReporters: string[] = [];
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.jobOrder.update({
          where: { id },
          data: { status: dto.status },
        });
        await tx.report.update({
          where: { id: job.reportId },
          data: { status: dto.status },
        });
        linkedReporters = await syncLinkedCopies(
          tx,
          job.reportId,
          dto.status,
          userId,
          job.jobOrderNo,
        );
        await tx.statusLog.create({
          data: {
            reportId: job.reportId,
            oldStatus: job.status,
            newStatus: dto.status,
            remarks: dto.remarks?.trim() || null,
            photoUrl,
            changedById: userId,
          },
        });
        return tx.jobOrder.findUnique({ where: { id }, include: jobInclude });
      });
    } catch (e) {
      await this.storage.removeQuietly(photoUrl);
      throw e;
    }

    this.events.statusChanged(
      {
        reportId: job.reportId,
        jobOrderId: id,
        status: dto.status,
        message: `${job.jobOrderNo} is now ${
          dto.status === Status.IN_PROGRESS ? 'in progress' : 'completed'
        }`,
      },
      [job.report.reporterId, job.technicianId, ...linkedReporters],
    );
    this.notifications.emit({
      type: 'job.status',
      reportId: job.reportId,
      jobOrderId: id,
      actorId: userId,
      status: dto.status === Status.IN_PROGRESS ? 'IN_PROGRESS' : 'COMPLETED',
    });
    return updated;
  }

  // coordinator/admin checks the finished work:
  // approve -> CLOSED, reject -> back to IN_PROGRESS for rework
  async verify(id: string, userId: string, dto: VerifyJobDto) {
    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: { report: { select: { reporterId: true } } },
    });
    if (!job) throw new NotFoundException('Job order not found');
    if (job.status !== Status.COMPLETED) {
      throw new BadRequestException('Only completed jobs can be verified');
    }

    const approved = dto.approved;
    const next = approved ? Status.CLOSED : Status.IN_PROGRESS;
    const note = dto.remarks?.trim() || null;

    let linkedReporters: string[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.jobOrder.update({
        where: { id },
        data: {
          status: next,
          verifiedById: approved ? userId : null,
          verifiedAt: approved ? new Date() : null,
        },
      });
      await tx.report.update({
        where: { id: job.reportId },
        data: { status: next },
      });
      linkedReporters = await syncLinkedCopies(
        tx,
        job.reportId,
        next,
        userId,
        job.jobOrderNo,
      );
      await tx.statusLog.create({
        data: {
          reportId: job.reportId,
          oldStatus: Status.COMPLETED,
          newStatus: next,
          remarks: approved
            ? note
              ? `Completion verified: ${note}`
              : 'Completion verified'
            : `Completion rejected, rework needed: ${note}`,
          changedById: userId,
        },
      });
      return tx.jobOrder.findUnique({ where: { id }, include: jobInclude });
    });

    this.events.statusChanged(
      {
        reportId: job.reportId,
        jobOrderId: id,
        status: next,
        message: approved
          ? `${job.jobOrderNo} was verified and closed`
          : `${job.jobOrderNo} was sent back for rework`,
      },
      [job.report.reporterId, job.technicianId, ...linkedReporters],
    );
    this.notifications.emit({
      type: 'job.verified',
      reportId: job.reportId,
      jobOrderId: id,
      actorId: userId,
      approved,
    });
    return updated;
  }

  // PDF uses the same access rules as viewing the job order
  async buildPdf(id: string, user: { userId: string; role: Role }) {
    const job = await this.findOne(id, user);
    const preparer = await this.prisma.user.findUnique({
      where: { id: job.createdById },
      select: { fullName: true },
    });
    const buffer = await buildJobOrderPdf(job, preparer?.fullName ?? null);
    return { buffer, filename: `${job.jobOrderNo}.pdf` };
  }

  // jobs can take days or weeks: the technician posts updates while work continues
  async addProgress(
    id: string,
    userId: string,
    dto: AddProgressDto,
    file?: Express.Multer.File,
  ) {
    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: { report: { select: { reporterId: true } } },
    });
    if (!job) throw new NotFoundException('Job order not found');
    if (job.technicianId !== userId) {
      throw new ForbiddenException('This job is not assigned to you');
    }
    if (job.status !== Status.IN_PROGRESS) {
      throw new BadRequestException(
        'Progress updates can only be added while the job is in progress',
      );
    }

    const photoUrl = await this.uploadWorkPhoto(job.reportId, file);
    try {
      await this.prisma.statusLog.create({
        data: {
          reportId: job.reportId,
          oldStatus: Status.IN_PROGRESS,
          newStatus: Status.IN_PROGRESS,
          remarks: dto.remarks.trim(),
          photoUrl,
          changedById: userId,
        },
      });
    } catch (e) {
      await this.storage.removeQuietly(photoUrl);
      throw e;
    }

    this.events.statusChanged(
      {
        reportId: job.reportId,
        jobOrderId: id,
        status: Status.IN_PROGRESS,
        message: `${job.jobOrderNo}: progress update`,
      },
      [job.report.reporterId, job.technicianId],
    );
    this.notifications.emit({
      type: 'job.progress',
      reportId: job.reportId,
      jobOrderId: id,
      actorId: userId,
      remarks: dto.remarks,
    });

    return this.prisma.jobOrder.findUnique({
      where: { id },
      include: jobInclude,
    });
  }

  // a job can be delayed because materials are unavailable
  async reportDelay(
    id: string,
    user: { userId: string; role: Role },
    dto: ReportDelayDto,
  ) {
    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: { report: { select: { reporterId: true } } },
    });
    if (!job) throw new NotFoundException('Job order not found');

    const isStaff = user.role === Role.COORDINATOR || user.role === Role.ADMIN;
    if (!isStaff && job.technicianId !== user.userId) {
      throw new ForbiddenException('This job is not assigned to you');
    }
    if (!isStaff && job.assignmentStatus !== AssignmentStatus.ACCEPTED) {
      throw new BadRequestException('Accept the job before reporting a delay');
    }
    if (job.status !== Status.ASSIGNED && job.status !== Status.IN_PROGRESS) {
      throw new BadRequestException(
        'A delay can only be recorded for jobs that are assigned or in progress',
      );
    }

    const reason = dto.reason.trim();
    const materials = dto.materialsNote?.trim() || null;
    const revised = dto.revisedTargetDate
      ? new Date(dto.revisedTargetDate)
      : null;

    if (revised) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (revised < today) {
        throw new BadRequestException(
          'The revised target date cannot be in the past',
        );
      }
    }

    const parts = [reason];
    if (materials) parts.push(`Materials: ${materials}`);
    parts.push(
      revised
        ? `Revised target date: ${revised.toISOString().slice(0, 10)}`
        : 'No revised target date yet',
    );

    let linkedReporters: string[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.materialDelay.create({
        data: {
          jobOrderId: id,
          reason,
          materialsNote: materials,
          revisedTargetDate: revised,
          previousStatus: job.status,
          reportedById: user.userId,
        },
      });
      await tx.jobOrder.update({
        where: { id },
        // the target date only changes when a real revised date was given
        data: {
          status: Status.DELAYED,
          ...(revised ? { targetDate: revised } : {}),
        },
      });
      await tx.report.update({
        where: { id: job.reportId },
        data: { status: Status.DELAYED },
      });
      linkedReporters = await syncLinkedCopies(
        tx,
        job.reportId,
        Status.DELAYED,
        user.userId,
        job.jobOrderNo,
      );
      await tx.statusLog.create({
        data: {
          reportId: job.reportId,
          oldStatus: job.status,
          newStatus: Status.DELAYED,
          remarks: `Material delay: ${parts.join('. ')}`,
          changedById: user.userId,
        },
      });
      return tx.jobOrder.findUnique({ where: { id }, include: jobInclude });
    });

    this.events.statusChanged(
      {
        reportId: job.reportId,
        jobOrderId: id,
        status: Status.DELAYED,
        message: `${job.jobOrderNo}: material delay recorded`,
      },
      [job.report.reporterId, job.technicianId, ...linkedReporters],
    );
    this.notifications.emit({
      type: 'job.status',
      reportId: job.reportId,
      jobOrderId: id,
      actorId: user.userId,
      status: 'DELAYED',
    });
    return updated;
  }

  // closes the open delay and returns the job to the status it had before
  async resume(
    id: string,
    user: { userId: string; role: Role },
    dto: ResumeJobDto,
  ) {
    const job = await this.prisma.jobOrder.findUnique({
      where: { id },
      include: {
        report: { select: { reporterId: true } },
        delays: {
          where: { resolvedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!job) throw new NotFoundException('Job order not found');

    const isStaff = user.role === Role.COORDINATOR || user.role === Role.ADMIN;
    if (!isStaff && job.technicianId !== user.userId) {
      throw new ForbiddenException('This job is not assigned to you');
    }
    if (job.status !== Status.DELAYED) {
      throw new BadRequestException('This job is not delayed');
    }
    const delay = job.delays[0];
    if (!delay)
      throw new BadRequestException('No open delay was found for this job');

    const resumeTo = delay.previousStatus;
    const note = dto.remarks?.trim();

    let linkedReporters: string[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.materialDelay.update({
        where: { id: delay.id },
        data: { resolvedAt: new Date(), resolvedById: user.userId },
      });
      await tx.jobOrder.update({ where: { id }, data: { status: resumeTo } });
      await tx.report.update({
        where: { id: job.reportId },
        data: { status: resumeTo },
      });
      linkedReporters = await syncLinkedCopies(
        tx,
        job.reportId,
        resumeTo,
        user.userId,
        job.jobOrderNo,
      );
      await tx.statusLog.create({
        data: {
          reportId: job.reportId,
          oldStatus: Status.DELAYED,
          newStatus: resumeTo,
          remarks: note
            ? `Delay resolved: ${note}`
            : 'Delay resolved, work can continue',
          changedById: user.userId,
        },
      });
      return tx.jobOrder.findUnique({ where: { id }, include: jobInclude });
    });

    this.events.statusChanged(
      {
        reportId: job.reportId,
        jobOrderId: id,
        status: resumeTo,
        message: `${job.jobOrderNo}: delay resolved`,
      },
      [job.report.reporterId, job.technicianId, ...linkedReporters],
    );
    this.notifications.emit({
      type: 'job.status',
      reportId: job.reportId,
      jobOrderId: id,
      actorId: user.userId,
      status: 'RESUMED',
    });
    return updated;
  }
}
