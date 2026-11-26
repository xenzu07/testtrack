import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AssignmentStatus, Status } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DeclineJobDto } from './dto/decline-job.dto';
import { JobOrdersService } from './job-orders.service';

const JOB = {
  id: 'job1',
  jobOrderNo: 'JO-2026-0009',
  reportId: 'rep1',
  technicianId: 'tech1',
  status: Status.ASSIGNED,
  assignmentStatus: AssignmentStatus.PENDING,
  report: { reporterId: 'reporter1' },
};

function setup(opts: { job?: object; updated?: number; lastMine?: AssignmentStatus | null } = {}) {
  const tx = {
    jobOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: opts.updated ?? 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'job1' }),
    },
    jobAssignment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.lastMine ? { status: opts.lastMine } : null),
    },
    statusLog: { create: jest.fn() },
  };
  const prisma = {
    jobOrder: { findUnique: jest.fn().mockResolvedValue({ ...JOB, ...opts.job }) },
    user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'Plumber One' }) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { statusChanged: jest.fn() };
  const svc = new JobOrdersService(prisma as never, events as never, {} as never, {} as never, { emit: jest.fn(), emitPriorityReview: jest.fn() } as never);
  return { svc, tx, prisma, events };
}

describe('JobOrdersService.respond (accept / decline)', () => {
  it('accept: only updates a PENDING offer for this technician, logs it, tells the reporter', async () => {
    const { svc, tx, events } = setup();
    await svc.respond('job1', 'tech1', true);

    expect(tx.jobOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job1',
        technicianId: 'tech1',
        status: Status.ASSIGNED,
        assignmentStatus: AssignmentStatus.PENDING,
      },
      data: { assignmentStatus: AssignmentStatus.ACCEPTED },
    });
    expect(tx.jobAssignment.updateMany.mock.calls[0][0].data.status).toBe(AssignmentStatus.ACCEPTED);
    expect(tx.statusLog.create.mock.calls[0][0].data.remarks).toBe('Plumber One accepted the job');
    const [event, rooms] = events.statusChanged.mock.calls[0];
    expect(event.kind).toBe('assignment.accepted');
    expect(rooms).toEqual(['reporter1', 'tech1']);
  });

  it('decline: frees the job, stores the reason, keeps the reason away from the reporter', async () => {
    const { svc, tx, events } = setup();
    await svc.respond('job1', 'tech1', false, '  On leave until Friday  ');

    expect(tx.jobOrder.updateMany.mock.calls[0][0].data).toEqual({
      assignmentStatus: AssignmentStatus.DECLINED,
      technicianId: null,
    });
    expect(tx.jobAssignment.updateMany.mock.calls[0][0].data).toMatchObject({
      status: AssignmentStatus.DECLINED,
      declineReason: 'On leave until Friday',
    });
    // reporter-visible history: no reason
    expect(tx.statusLog.create.mock.calls[0][0].data.remarks).not.toContain('leave');
    const [event, rooms] = events.statusChanged.mock.calls[0];
    expect(event.kind).toBe('assignment.declined');
    expect(event.message).toContain('On leave until Friday');
    expect(rooms).toEqual(['tech1']); // + coordinators, added by the gateway
  });

  it('decline needs a real reason', async () => {
    const { svc, prisma } = setup();
    await expect(svc.respond('job1', 'tech1', false, '   ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.respond('job1', 'tech1', false, 'no')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    const errors = (reason: unknown) => validateSync(plainToInstance(DeclineJobDto, { reason }));
    expect(errors('Busy')).not.toHaveLength(0);
    expect(errors('x'.repeat(501))).not.toHaveLength(0);
    expect(errors('No ladder available today')).toHaveLength(0);
  });

  it('second answer is rejected and nothing else is written', async () => {
    const accepted = setup({ updated: 0, job: { assignmentStatus: AssignmentStatus.ACCEPTED } });
    await expect(accepted.svc.respond('job1', 'tech1', true)).rejects.toThrow('You already accepted this job');
    expect(accepted.tx.jobAssignment.updateMany).not.toHaveBeenCalled();
    expect(accepted.tx.statusLog.create).not.toHaveBeenCalled();
    expect(accepted.events.statusChanged).not.toHaveBeenCalled();

    const declined = setup({ updated: 0, job: { technicianId: null }, lastMine: AssignmentStatus.DECLINED });
    await expect(declined.svc.respond('job1', 'tech1', false, 'Still unavailable')).rejects.toThrow(
      'You already declined this job',
    );
  });

  it('a technician the job was taken away from cannot answer it', async () => {
    const { svc } = setup({ updated: 0, job: { technicianId: 'someone-else' }, lastMine: AssignmentStatus.CANCELLED });
    await expect(svc.respond('job1', 'tech1', true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a conflict is a ConflictException (HTTP 409)', async () => {
    const { svc } = setup({ updated: 0 });
    await expect(svc.respond('job1', 'tech1', true)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('JobOrdersService.updateStatus guard', () => {
  it('cannot start work before accepting', async () => {
    const prisma = {
      jobOrder: {
        findUnique: jest.fn().mockResolvedValue({ ...JOB, assignmentStatus: AssignmentStatus.PENDING }),
      },
    };
    const svc = new JobOrdersService(prisma as never, {} as never, {} as never, {} as never, { emit: jest.fn(), emitPriorityReview: jest.fn() } as never);
    await expect(
      svc.updateStatus('job1', 'tech1', { status: Status.IN_PROGRESS }),
    ).rejects.toThrow('Accept the job before starting work');
  });
});
