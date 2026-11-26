// Scenario tests for the coordinator workflow rules:
//   - a technician holds at most MAX_ACTIVE_JOBS active jobs
//   - opening a Submitted report puts it Under review (once)
//   - linked duplicates and cancelled merged jobs are left out of lists
//   - a linked report's priority cannot be changed
//   - duplicate detection flags only the earliest matching report
//   - three or more reports of one problem end up under one main report
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role, Status } from '@prisma/client';
import { MAX_ACTIVE_JOBS } from './routing/assignment-recommender';
import { TechniciansService } from './technicians/technicians.service';
import { JobOrdersService } from './job-orders/job-orders.service';
import { ReportsService } from './reports/reports.service';
import { PriorityService } from './priority/priority.service';
import { DuplicatesService } from './duplicates/duplicates.service';
import { linkSameProblem } from './duplicates/report-links';

const TECH = { id: 'tech1', fullName: 'Plumber One', role: Role.TECHNICIAN, isActive: true };

/* ------------------------------------------------------------ job limit */

describe('technician active-job limit', () => {
  function technicians(active: number) {
    const prisma = {
      jobOrder: { count: jest.fn().mockResolvedValue(active) },
      user: { count: jest.fn().mockResolvedValue(1) },
    };
    return { svc: new TechniciansService(prisma as never), prisma };
  }

  it('counts only assigned, in-progress and delayed jobs', async () => {
    const { svc, prisma } = technicians(2);
    await svc.activeJobCount('tech1');
    expect(prisma.jobOrder.count.mock.calls[0][0].where).toEqual({
      technicianId: 'tech1',
      status: { in: [Status.ASSIGNED, Status.IN_PROGRESS, Status.DELAYED] },
    });
  });

  it(`allows a job while below ${MAX_ACTIVE_JOBS}, refuses at the limit`, async () => {
    await expect(technicians(MAX_ACTIVE_JOBS - 1).svc.assertHasRoom(TECH)).resolves.toBeUndefined();
    await expect(technicians(MAX_ACTIVE_JOBS).svc.assertHasRoom(TECH)).rejects.toThrow(
      `Plumber One already has ${MAX_ACTIVE_JOBS} active jobs`,
    );
  });

  function jobs(active: number) {
    const tx = {
      jobOrder: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'job1' }),
        // after the move the job itself is counted
        count: jest.fn().mockResolvedValue(active + 1),
      },
      jobAssignment: { updateMany: jest.fn(), create: jest.fn() },
      statusLog: { create: jest.fn() },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(TECH), count: jest.fn().mockResolvedValue(1) },
      jobOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job1',
          jobOrderNo: 'JO-1',
          reportId: 'rep1',
          tradeUnitId: 'u1',
          status: Status.ASSIGNED,
          technicianId: null,
          technician: null,
          report: { reporterId: 'r1' },
        }),
        count: jest.fn().mockResolvedValue(active),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const svc = new JobOrdersService(
      prisma as never,
      { statusChanged: jest.fn() } as never,
      {} as never,
      new TechniciansService(prisma as never),
      { emit: jest.fn() } as never,
    );
    return { svc, tx };
  }

  it('assigning a technician at the limit is refused before anything changes', async () => {
    const { svc, tx } = jobs(MAX_ACTIVE_JOBS);
    await expect(svc.assignTechnician('job1', 'coord', { technicianId: 'tech1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.jobOrder.updateMany).not.toHaveBeenCalled();
  });

  it('assigning a technician with room works', async () => {
    const { svc, tx } = jobs(MAX_ACTIVE_JOBS - 1);
    await svc.assignTechnician('job1', 'coord', { technicianId: 'tech1' });
    expect(tx.jobOrder.updateMany).toHaveBeenCalled();
    expect(tx.jobAssignment.create).toHaveBeenCalled();
  });
});

describe('creating a job order with a technician', () => {
  function setup(activeBefore: number) {
    const tx = {
      jobOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'job1', jobOrderNo: 'JO-2026-0001' }),
        // inside the transaction the new job is already counted
        count: jest.fn().mockResolvedValue(activeBefore + 1),
        findUnique: jest.fn().mockResolvedValue({ id: 'job1' }),
      },
      jobAssignment: { create: jest.fn() },
      report: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      statusLog: { create: jest.fn() },
    };
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rep1',
          status: Status.UNDER_REVIEW,
          jobOrder: null,
          duplicateOfId: null,
          proposedTradeUnitId: 'u1',
          proposedTradeUnit: { id: 'u1', name: 'Plumbing' },
          reporterId: 'r1',
          jobOrderForm: { formNo: 'JOF-2026-0001', status: 'APPROVED' },
        }),
      },
      tradeUnit: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', name: 'Plumbing' }) },
      user: { findUnique: jest.fn().mockResolvedValue(TECH), count: jest.fn().mockResolvedValue(1) },
      jobOrder: { count: jest.fn().mockResolvedValue(activeBefore) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const svc = new JobOrdersService(
      prisma as never,
      { statusChanged: jest.fn() } as never,
      {} as never,
      new TechniciansService(prisma as never),
      { emit: jest.fn() } as never,
    );
    return { svc, tx };
  }

  it(`gives a technician with ${MAX_ACTIVE_JOBS - 1} jobs their ${MAX_ACTIVE_JOBS}th`, async () => {
    const { svc, tx } = setup(MAX_ACTIVE_JOBS - 1);
    // later steps (reading the result back) are not modelled; only the limit matters here
    await svc.create('coord', { reportId: 'rep1', technicianId: 'tech1' } as never).catch(() => undefined);
    expect(tx.jobAssignment.create).toHaveBeenCalled();
  });

  it(`refuses a technician who already has ${MAX_ACTIVE_JOBS}`, async () => {
    const { svc, tx } = setup(MAX_ACTIVE_JOBS);
    await expect(svc.create('coord', { reportId: 'rep1', technicianId: 'tech1' } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.jobOrder.create).not.toHaveBeenCalled();
  });
});

describe('the Job Order Form gates the job order', () => {
  function setup(form: object | null) {
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rep1',
          status: Status.UNDER_REVIEW,
          jobOrder: null,
          duplicateOfId: null,
          proposedTradeUnitId: 'u1',
          proposedTradeUnit: { id: 'u1', name: 'Plumbing' },
          jobOrderForm: form,
        }),
      },
      tradeUnit: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = new JobOrdersService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    return { svc, prisma };
  }

  it('refuses while the form is only sent or received', async () => {
    for (const status of ['SUBMITTED', 'RECEIVED', 'RETURNED']) {
      const { svc, prisma } = setup({ formNo: 'JOF-2026-0061', status });
      await expect(svc.create('coord', { reportId: 'rep1' } as never)).rejects.toThrow(/Accept the reporter's Job Order Form/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('refuses when no form was signed', async () => {
    const { svc } = setup(null);
    await expect(svc.create('coord', { reportId: 'rep1' } as never)).rejects.toThrow(/has not signed a Job Order Form/);
  });
});

/* ------------------------------------------------------------ lists */

describe('lists leave out duplicates', () => {
  it('job order lists (coordinator and technician) leave out cancelled merged jobs', async () => {
    const prisma = { jobOrder: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = new JobOrdersService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    await svc.findAll();
    expect(prisma.jobOrder.findMany.mock.calls[0][0].where).toEqual({ status: { not: Status.CANCELLED } });
    await svc.findAll(Status.CLOSED);
    expect(prisma.jobOrder.findMany.mock.calls[1][0].where).toEqual({ status: Status.CLOSED });
    await svc.findAssigned('tech1');
    expect(prisma.jobOrder.findMany.mock.calls[2][0].where).toEqual({
      technicianId: 'tech1',
      status: { not: Status.CANCELLED },
    });
  });

  it('the coordinator report list leaves out linked copies', async () => {
    const prisma = { report: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = new ReportsService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    await svc.findAll({});
    expect(prisma.report.findMany.mock.calls[0][0].where.duplicateOfId).toBeNull();
  });

  it("a reporter never sees who reported the earlier, linked report", async () => {
    const reports = [{ id: 'mine', duplicateOfId: 'theirs', duplicateOf: { id: 'theirs', reporter: { fullName: 'Carlo Dizon' } } }];
    const prisma = { report: { findMany: jest.fn().mockResolvedValue(reports) } };
    const svc = new ReportsService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    const out = (await svc.findMine('r1')) as { duplicateOf: Record<string, unknown> }[];
    expect(out[0].duplicateOf).toEqual({ id: 'theirs' });
  });

  it("a reporter's repeat of their own report is shown once; a link to someone else's report stays", async () => {
    const reports = [
      { id: 'mine-repeat', duplicateOfId: 'mine-original' },
      { id: 'mine-original', duplicateOfId: null },
      { id: 'linked-to-other', duplicateOfId: 'someone-elses' },
    ];
    const prisma = { report: { findMany: jest.fn().mockResolvedValue(reports) } };
    const svc = new ReportsService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    const out = (await svc.findMine('r1')) as { id: string }[];
    expect(out.map((r) => r.id)).toEqual(['mine-original', 'linked-to-other']);
  });
});

/* ------------------------------------------------------------ under review */

describe('opening a report puts it Under review', () => {
  function setup(report: object, updated = 1) {
    const tx = {
      report: {
        updateMany: jest.fn().mockResolvedValue({ count: updated }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      statusLog: { create: jest.fn() },
    };
    const prisma = {
      report: { findUnique: jest.fn().mockResolvedValue(report) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const events = { statusChanged: jest.fn() };
    const notifications = { emit: jest.fn() };
    const svc = new ReportsService(prisma as never, events as never, {} as never, {} as never, notifications as never);
    return { svc, tx, events, notifications };
  }

  it('a Submitted report changes once, is logged, and the reporter is told', async () => {
    const { svc, tx, events, notifications } = setup({ id: 'rep1', reporterId: 'r1', duplicateOfId: null });
    expect(await svc.startReview('rep1', 'coord')).toEqual({ changed: true });
    expect(tx.report.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'rep1', status: Status.SUBMITTED, jobOrder: null },
      data: { status: Status.UNDER_REVIEW },
    });
    expect(tx.statusLog.create.mock.calls[0][0].data).toMatchObject({
      oldStatus: Status.SUBMITTED,
      newStatus: Status.UNDER_REVIEW,
    });
    expect(events.statusChanged.mock.calls[0][1]).toContain('r1');
    expect(notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'report.routed' }));
  });

  it('opening it again (already Under review) changes and logs nothing', async () => {
    const { svc, tx, notifications } = setup({ id: 'rep1', reporterId: 'r1', duplicateOfId: null }, 0);
    expect(await svc.startReview('rep1', 'coord')).toEqual({ changed: false });
    expect(tx.statusLog.create).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('a linked report is left alone (it follows its main report)', async () => {
    const { svc, tx } = setup({ id: 'rep2', reporterId: 'r2', duplicateOfId: 'rep1' });
    expect(await svc.startReview('rep2', 'coord')).toEqual({ changed: false });
    expect(tx.report.updateMany).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ priority */

describe('priority of a linked report', () => {
  const linked = { id: 'rep2', priority: 'P2', autoPriority: 'P2', priorityLocked: false, duplicateOfId: 'rep1' };

  it('cannot be confirmed or changed', async () => {
    const prisma = { report: { findUnique: jest.fn().mockResolvedValue(linked), update: jest.fn() } };
    const svc = new PriorityService(prisma as never);
    await expect(svc.confirm('rep2', 'coord')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.adjust('rep2', 'coord', 'P1', 'urgent leak')).rejects.toThrow(/Change the priority on that report/);
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it('is never put up for review again when recalculated', async () => {
    const report = {
      status: Status.UNDER_REVIEW,
      jobOrder: null,
      affectedPeople: null, // missing answers would normally ask for review
      safetyHazard: null,
      blocksUse: null,
      priority: 'P3',
      priorityLocked: false,
      reviewFlags: [],
      needsReview: false,
      duplicateOfId: 'rep1',
      category: { severity: 2 },
      _count: { duplicates: 0, duplicateFlags: 1 },
    };
    const prisma = { report: { findUnique: jest.fn().mockResolvedValue(report), update: jest.fn() } };
    await new PriorityService(prisma as never).recalculate('rep2');
    expect(prisma.report.update.mock.calls[0][0].data.needsReview).toBe(false);
  });
});

/* ------------------------------------------------------------ detection */

describe('duplicate detection', () => {
  const loc = { building: 'CTMO Building', floor: '1st Floor' };
  const base = { categoryId: 'leak', locationId: 'room1', description: 'Water leaking from the ceiling', location: loc };

  it('flags only the earliest matching report', async () => {
    const newest = { id: 'new', createdAt: new Date('2026-11-26T10:00:00Z'), ...base };
    const earliest = { id: 'earliest', createdAt: new Date('2026-11-20T10:00:00Z'), ...base };
    const middle = { id: 'middle', createdAt: new Date('2026-11-24T10:00:00Z'), ...base };
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue(newest),
        // the database returns newest first
        findMany: jest.fn().mockResolvedValue([middle, earliest]),
      },
      duplicateFlag: { upsert: jest.fn() },
    };
    const svc = new DuplicatesService(prisma as never, {} as never, {} as never, {} as never);
    expect(await svc.detectFor('new')).toBe(1);
    expect(prisma.duplicateFlag.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.duplicateFlag.upsert.mock.calls[0][0].create).toMatchObject({ reportId: 'new', candidateId: 'earliest' });
    // only originals are compared, never linked copies
    expect(prisma.report.findMany.mock.calls[0][0].where.duplicateOfId).toBeNull();
  });

  it('an obvious match beats an older weak one', async () => {
    // same category, same building, but another room and other wording
    const olderWeak = {
      id: 'older-weak',
      createdAt: new Date('2026-11-01T10:00:00Z'),
      categoryId: 'leak',
      locationId: 'room9',
      description: 'Pipe near the stairs drips sometimes',
      location: loc,
    };
    const sameRoom = { id: 'same-room', createdAt: new Date('2026-11-25T10:00:00Z'), ...base };
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({ id: 'new', createdAt: new Date('2026-11-26T10:00:00Z'), ...base }),
        findMany: jest.fn().mockResolvedValue([sameRoom, olderWeak]),
      },
      duplicateFlag: { upsert: jest.fn() },
    };
    const svc = new DuplicatesService(prisma as never, {} as never, {} as never, {} as never);
    expect(await svc.detectFor('new')).toBe(1);
    expect(prisma.duplicateFlag.upsert.mock.calls[0][0].create.candidateId).toBe('same-room');
  });

  it('another room on the same floor loses to the same room, even with the same wording', async () => {
    const otherRoom = { ...base, id: 'other-room', locationId: 'clinic', createdAt: new Date('2026-11-01T10:00:00Z') };
    const sameRoom = { ...base, id: 'same-room', createdAt: new Date('2026-11-25T10:00:00Z') };
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({ id: 'new', createdAt: new Date('2026-11-26T10:00:00Z'), ...base }),
        findMany: jest.fn().mockResolvedValue([sameRoom, otherRoom]),
      },
      duplicateFlag: { upsert: jest.fn() },
    };
    const svc = new DuplicatesService(prisma as never, {} as never, {} as never, {} as never);
    await svc.detectFor('new');
    expect(prisma.duplicateFlag.upsert.mock.calls[0][0].create.candidateId).toBe('same-room');
  });

  it('the same room wins even when another room has identical wording and is older', async () => {
    const otherRoom = { ...base, id: 'other-room', locationId: 'clinic', createdAt: new Date('2026-11-01T10:00:00Z') };
    const sameRoom = {
      ...base,
      id: 'same-room',
      description: 'Ceiling is leaking water near the door',
      createdAt: new Date('2026-11-25T10:00:00Z'),
    };
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({ id: 'new', createdAt: new Date('2026-11-26T10:00:00Z'), ...base }),
        findMany: jest.fn().mockResolvedValue([sameRoom, otherRoom]),
      },
      duplicateFlag: { upsert: jest.fn() },
    };
    const svc = new DuplicatesService(prisma as never, {} as never, {} as never, {} as never);
    await svc.detectFor('new');
    expect(prisma.duplicateFlag.upsert.mock.calls[0][0].create.candidateId).toBe('same-room');
  });

  it('flags nothing when no earlier report is similar enough', async () => {
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({ id: 'new', createdAt: new Date(), ...base }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'other',
            createdAt: new Date('2026-11-01'),
            categoryId: 'chair',
            locationId: 'room9',
            description: 'Broken chair',
            location: { building: 'CTMO Building', floor: '3rd Floor' },
          },
        ]),
      },
      duplicateFlag: { upsert: jest.fn() },
    };
    const svc = new DuplicatesService(prisma as never, {} as never, {} as never, {} as never);
    expect(await svc.detectFor('new')).toBe(0);
    expect(prisma.duplicateFlag.upsert).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ three reports */

describe('three reports of one problem', () => {
  type Flag = { id: string; reportId: string; candidateId: string; status: string };
  type Pair = { reportId?: string; candidateId?: string };
  // minimal in-memory database for linkSameProblem
  function db() {
    const r: Record<string, { id: string; status: Status; reporterId: string; duplicateOfId: string | null; jobOrder: null }> = {};
    for (const id of ['a', 'b', 'c'])
      r[id] = { id, status: Status.UNDER_REVIEW, reporterId: `rep-${id}`, duplicateOfId: null, jobOrder: null };
    const flags: Flag[] = [
      { id: 'b-a', reportId: 'b', candidateId: 'a', status: 'CONFIRMED' },
      { id: 'c-b', reportId: 'c', candidateId: 'b', status: 'OPEN' },
    ];
    const matches = (f: Flag, o: Pair) =>
      (o.reportId ?? f.reportId) === f.reportId && (o.candidateId ?? f.candidateId) === f.candidateId;
    const tx = {
      report: {
        findUnique: jest.fn(({ where }) => Promise.resolve(r[where.id] ? { ...r[where.id] } : null)),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            Object.values(r).filter(
              (x) => x.duplicateOfId === where.duplicateOfId && (!where.status?.not || x.status !== where.status.not),
            ),
          ),
        ),
        update: jest.fn(({ where, data }) => Promise.resolve(Object.assign(r[where.id], data))),
        updateMany: jest.fn(({ where, data }) => {
          Object.values(r)
            .filter((x) => x.duplicateOfId === where.duplicateOfId)
            .forEach((x) => Object.assign(x, data));
          return Promise.resolve({ count: 1 });
        }),
      },
      jobOrder: { update: jest.fn() },
      jobAssignment: { updateMany: jest.fn() },
      materialDelay: { updateMany: jest.fn() },
      statusLog: { create: jest.fn() },
      duplicateFlag: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(flags.filter((f) => f.status === where.status && where.OR.some((o: Pair) => matches(f, o)))),
        ),
        count: jest.fn(({ where }) => Promise.resolve(flags.filter((f) => where.OR.some((o: Pair) => matches(f, o))).length)),
        delete: jest.fn(({ where }) => Promise.resolve(flags.splice(flags.findIndex((f) => f.id === where.id), 1))),
        update: jest.fn(({ where, data }) => Promise.resolve(Object.assign(flags.find((f) => f.id === where.id)!, data))),
      },
    };
    return { tx, r, flags };
  }

  it('after B is linked to A, C is decided against A and links to A (no chain)', async () => {
    const { tx, r, flags } = db();
    await linkSameProblem(tx as never, 'a', 'b', 'coord');
    expect(r.b.duplicateOfId).toBe('a');
    // C's open suggestion now points at the main report A
    expect(flags.find((f) => f.id === 'c-b')).toMatchObject({ reportId: 'c', candidateId: 'a', status: 'OPEN' });

    await linkSameProblem(tx as never, 'a', 'c', 'coord');
    expect(r.c.duplicateOfId).toBe('a');
    expect(r.a.duplicateOfId).toBeNull();
  });

  it('linking a report to a copy instead of the original is refused', async () => {
    const { tx } = db();
    await linkSameProblem(tx as never, 'a', 'b', 'coord');
    await expect(linkSameProblem(tx as never, 'b', 'c', 'coord')).rejects.toThrow(/link to the original/);
  });
});
