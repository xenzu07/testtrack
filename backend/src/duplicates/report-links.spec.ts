import { BadRequestException } from '@nestjs/common';
import { AssignmentStatus, Status } from '@prisma/client';
import { JobLike, chooseKeptJob, linkSameProblem, unlinkReport } from './report-links';
import { JobOrdersService } from '../job-orders/job-orders.service';

const job = (id: string, status: Status, ans: AssignmentStatus | null = null, tech: string | null = 't1'): JobLike => ({
  id,
  jobOrderNo: `JO-${id}`,
  status,
  assignmentStatus: ans,
  technicianId: tech,
});

describe('chooseKeptJob', () => {
  it('keeps the job that is further along', () => {
    const started = job('a', Status.IN_PROGRESS, AssignmentStatus.ACCEPTED);
    const accepted = job('b', Status.ASSIGNED, AssignmentStatus.ACCEPTED);
    const pending = job('c', Status.ASSIGNED, AssignmentStatus.PENDING);
    const none = job('d', Status.ASSIGNED, null, null);
    expect(chooseKeptJob(accepted, started).keep.id).toBe('a');
    expect(chooseKeptJob(pending, accepted).keep.id).toBe('b');
    expect(chooseKeptJob(none, pending).keep.id).toBe('c');
  });

  it('keeps the older report on a tie (the reported case: same technician, both accepted)', () => {
    const r = chooseKeptJob(job('old', Status.ASSIGNED, 'ACCEPTED'), job('new', Status.ASSIGNED, 'ACCEPTED'));
    expect([r.keep.id, r.drop.id]).toEqual(['old', 'new']);
  });

  it('a finished job is kept, never cancelled', () => {
    const done = job('done', Status.COMPLETED, 'ACCEPTED');
    const open = job('open', Status.ASSIGNED, 'ACCEPTED');
    expect(chooseKeptJob(open, done).keep.id).toBe('done');
    expect(() => chooseKeptJob(open, done, 'open')).toThrow(/cannot be cancelled/);
    expect(() => chooseKeptJob(done, job('x', Status.CLOSED))).toThrow(/nothing to merge/);
  });

  it('honours the coordinator choice', () => {
    const r = chooseKeptJob(job('a', Status.IN_PROGRESS), job('b', Status.ASSIGNED), 'b');
    expect([r.keep.id, r.drop.id]).toEqual(['b', 'a']);
    expect(() => chooseKeptJob(job('a', Status.ASSIGNED), job('b', Status.ASSIGNED), 'zzz')).toThrow(BadRequestException);
  });
});

// a tiny in-memory stand-in for the database calls linkSameProblem makes
function db(reports: Record<string, { status: Status; reporterId: string; duplicateOfId?: string | null; jobOrder?: JobLike | null }>) {
  const r = Object.fromEntries(
    Object.entries(reports).map(([id, v]) => [id, { id, duplicateOfId: null, jobOrder: null, ...v }]),
  ) as Record<string, { id: string; status: Status; reporterId: string; duplicateOfId: string | null; jobOrder: JobLike | null }>;
  const jobs: Record<string, Record<string, unknown>> = {};
  const logs: { reportId: string; remarks: string }[] = [];
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
      update: jest.fn(({ where, data }) => {
        Object.assign(r[where.id], data);
        return Promise.resolve(r[where.id]);
      }),
      updateMany: jest.fn(({ where, data }) => {
        Object.values(r).filter((x) => x.duplicateOfId === where.duplicateOfId).forEach((x) => Object.assign(x, data));
        return Promise.resolve({ count: 1 });
      }),
    },
    jobOrder: {
      update: jest.fn(({ where, data }) => {
        jobs[where.id] = { ...(jobs[where.id] ?? {}), ...data };
        return Promise.resolve(jobs[where.id]);
      }),
    },
    jobAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    materialDelay: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    statusLog: { create: jest.fn(({ data }) => logs.push(data)) },
  };
  return { tx, r, jobs, logs };
}

describe('linkSameProblem', () => {
  it('both have accepted job orders: one is cancelled as merged, the copy follows the main report', async () => {
    const { tx, r, jobs } = db({
      older: { status: Status.ASSIGNED, reporterId: 'rep-a', jobOrder: job('5', Status.ASSIGNED, 'ACCEPTED') },
      newer: { status: Status.ASSIGNED, reporterId: 'rep-b', jobOrder: job('6', Status.ASSIGNED, 'ACCEPTED') },
    });
    const out = await linkSameProblem(tx as never, 'older', 'newer', 'coord');

    expect(out.mainReportId).toBe('older');
    expect(out.keptJobOrderNo).toBe('JO-5');
    expect(out.cancelledJob).toMatchObject({ id: '6', technicianId: 't1' });
    expect(jobs['6']).toMatchObject({ status: Status.CANCELLED, mergedIntoId: '5', assignmentStatus: AssignmentStatus.CANCELLED });
    expect(r.newer.duplicateOfId).toBe('older');
    expect(tx.jobAssignment.updateMany).toHaveBeenCalled();
  });

  it('existing data: the kept job is already completed, the copy gets its status', async () => {
    const { tx, r, jobs } = db({
      older: { status: Status.COMPLETED, reporterId: 'rep-a', jobOrder: job('5', Status.COMPLETED, 'ACCEPTED') },
      newer: { status: Status.ASSIGNED, reporterId: 'rep-b', jobOrder: job('6', Status.ASSIGNED, 'ACCEPTED') },
    });
    await linkSameProblem(tx as never, 'older', 'newer', 'coord');
    expect(jobs['6'].status).toBe(Status.CANCELLED);
    expect(r.newer.status).toBe(Status.COMPLETED);
  });

  it('only the newer report has a job order: it becomes the main report', async () => {
    const { tx, r, jobs } = db({
      older: { status: Status.SUBMITTED, reporterId: 'rep-a' },
      newer: { status: Status.IN_PROGRESS, reporterId: 'rep-b', jobOrder: job('7', Status.IN_PROGRESS, 'ACCEPTED') },
    });
    const out = await linkSameProblem(tx as never, 'older', 'newer', 'coord');
    expect(out.mainReportId).toBe('newer');
    expect(r.older.duplicateOfId).toBe('newer');
    expect(r.older.status).toBe(Status.IN_PROGRESS);
    expect(Object.keys(jobs)).toHaveLength(0); // nothing cancelled
  });

  it('reports already linked to the copy move to the main report (no chains)', async () => {
    const { tx, r } = db({
      older: { status: Status.ASSIGNED, reporterId: 'rep-a', jobOrder: job('5', Status.IN_PROGRESS, 'ACCEPTED') },
      newer: { status: Status.SUBMITTED, reporterId: 'rep-b' },
      third: { status: Status.SUBMITTED, reporterId: 'rep-c', duplicateOfId: 'newer' },
    });
    const out = await linkSameProblem(tx as never, 'older', 'newer', 'coord');
    expect(r.third.duplicateOfId).toBe('older');
    expect(out.reporterIds).toEqual(expect.arrayContaining(['rep-b', 'rep-c']));
  });
});

describe('unlinkReport', () => {
  it('reopens a job order that was cancelled by the merge, without a technician', async () => {
    const { tx, r, jobs } = db({
      copy: {
        status: Status.IN_PROGRESS,
        reporterId: 'rep-b',
        duplicateOfId: 'main',
        jobOrder: job('6', Status.CANCELLED, AssignmentStatus.CANCELLED),
      },
    });
    await unlinkReport(tx as never, 'copy', 'coord');
    expect(r.copy.duplicateOfId).toBeNull();
    expect(jobs['6']).toMatchObject({ status: Status.ASSIGNED, technicianId: null, mergedIntoId: null });
    expect(r.copy.status).toBe(Status.ASSIGNED);
  });
});

describe('JobOrdersService.create', () => {
  it('refuses a separate job order for a linked duplicate', async () => {
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'copy',
          status: Status.SUBMITTED,
          jobOrder: null,
          duplicateOfId: 'main',
          proposedTradeUnit: {},
        }),
      },
    };
    const svc = new JobOrdersService(prisma as never, {} as never, {} as never, {} as never, { emit: jest.fn(), emitPriorityReview: jest.fn() } as never);
    await expect(svc.create('coord', { reportId: 'copy' })).rejects.toThrow(/linked to another report/);
  });
});
