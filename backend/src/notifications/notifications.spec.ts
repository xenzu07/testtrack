import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PushPlatform } from '@prisma/client';
import { COORDINATORS, ReportContext, dedupeKey, messagesFor } from './notification-rules';
import { NotificationsService } from './notifications.service';

const ctx: ReportContext = {
  id: 'r1',
  category: 'Water Leak',
  location: 'Science Building, 2nd Floor, Room 101',
  reporterId: 'rep',
  reporterName: 'Test Student',
  linkedReporterIds: ['rep2'],
  jobOrderNo: 'JO-2026-0001',
  technicianId: 'tech',
  technicianName: 'Plumber One',
  formNo: 'JOF-2026-0001',
  priority: 'P2',
  reviewFlags: ['missing_impact'],
};

describe('notification rules', () => {
  it('new report: confirmation to the reporter, alert to coordinators', () => {
    const m = messagesFor({ type: 'report.submitted', reportId: 'r1', actorId: 'rep' }, ctx);
    expect(m.map((x) => [x.to, x.kind])).toEqual([
      [['rep'], 'report.received'],
      [COORDINATORS, 'report.new'],
    ]);
  });

  it('new job: the technician gets the offer, reporters (incl. linked) get the update', () => {
    const m = messagesFor(
      { type: 'job.created', reportId: 'r1', jobOrderId: 'j1', actorId: 'coord', technicianId: 'tech' },
      ctx,
    );
    expect(m.find((x) => x.kind === 'job.offered')?.to).toEqual(['tech']);
    expect(m.find((x) => x.kind === 'report.status')?.to).toEqual(['rep', 'rep2']);
  });

  it('decline: technician confirmation + coordinator alert, the reporter is not told', () => {
    const m = messagesFor(
      { type: 'job.answered', reportId: 'r1', jobOrderId: 'j1', technicianId: 'tech', accepted: false, reason: 'No tools' },
      ctx,
    );
    expect(m.map((x) => x.kind)).toEqual(['job.answer', 'job.declined']);
    expect(m[1].body).toContain('No tools');
  });

  it('reassignment tells the previous technician the job left their list', () => {
    const m = messagesFor(
      { type: 'job.reassigned', reportId: 'r1', jobOrderId: 'j1', actorId: 'c', technicianId: 't2', previousTechnicianId: 'tech' },
      ctx,
    );
    expect(m.map((x) => [x.kind, x.to])).toEqual([
      ['job.offered', ['t2']],
      ['job.withdrawn', ['tech']],
    ]);
  });

  it('completion goes to reporters and coordinators; verification to the technician', () => {
    const done = messagesFor({ type: 'job.status', reportId: 'r1', jobOrderId: 'j1', actorId: 'tech', status: 'COMPLETED' }, ctx);
    expect(done.map((x) => x.title)).toEqual(['Work completed', 'Job completed']);
    const verified = messagesFor({ type: 'job.verified', reportId: 'r1', jobOrderId: 'j1', actorId: 'c', approved: true }, ctx);
    expect(verified.find((x) => x.kind === 'job.verified')?.to).toEqual(['tech']);
  });

  it('forms: coordinators get new forms, the requester gets decisions', () => {
    expect(messagesFor({ type: 'form.submitted', reportId: 'r1', formId: 'f1', actorId: 'rep' }, ctx).map((x) => x.kind)).toEqual([
      'form.status',
      'form.new',
    ]);
    const back = messagesFor(
      { type: 'form.decided', reportId: 'r1', formId: 'f1', actorId: 'c', action: 'return', note: 'Add your office' },
      ctx,
    );
    expect(back).toHaveLength(1);
    expect(back[0].to).toEqual(['rep']);
    expect(back[0].body).toContain('Add your office');
  });

  it('dedupe keys are stable per occurrence and differ per recipient kind', () => {
    const e = { type: 'job.progress' as const, reportId: 'r1', jobOrderId: 'j1', actorId: 'tech' };
    expect(dedupeKey(e, 'report.progress', 'log9')).toBe(dedupeKey(e, 'report.progress', 'log9'));
    expect(dedupeKey(e, 'report.progress', 'log9')).not.toBe(dedupeKey(e, 'report.progress', 'log10'));
  });
});

describe('NotificationsService.deliver', () => {
  function setup(active = ['rep', 'rep2', 'c1', 'c2', 'tech']) {
    const created: any[] = [];
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          reporterId: 'rep',
          priority: 'P2',
          reviewFlags: [],
          reporter: { fullName: 'Test Student' },
          category: { name: 'Water Leak' },
          location: { building: 'Science Building', floor: '2nd Floor', room: 'Room 101' },
          duplicates: [{ reporterId: 'rep2' }],
          jobOrder: { jobOrderNo: 'JO-2026-0001', technicianId: 'tech', technician: { fullName: 'Plumber One' } },
          jobOrderForm: null,
        }),
      },
      statusLog: { findFirst: jest.fn().mockResolvedValue({ id: 'log1' }) },
      jobAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'as1' }) },
      user: {
        findMany: jest.fn((args: any) =>
          Promise.resolve(
            args.where.role
              ? [{ id: 'c1' }, { id: 'c2' }]
              : args.where.id.in.filter((id: string) => active.includes(id)).map((id: string) => ({ id })),
          ),
        ),
      },
      notification: {
        createManyAndReturn: jest.fn((args: any) => {
          // emulate the unique (userId, dedupeKey) index
          const fresh = args.data.filter(
            (d: any) => !created.some((c) => c.userId === d.userId && c.dedupeKey === d.dedupeKey),
          );
          const rows = fresh.map((d: any, i: number) => ({ id: `n${created.length + i}`, ...d }));
          created.push(...rows);
          return Promise.resolve(rows);
        }),
      },
    };
    const events = { notification: jest.fn() };
    const push = { sendToUser: jest.fn().mockResolvedValue(undefined), status: { phone: false, browser: false } };
    const svc = new NotificationsService(prisma as never, events as never, push as never);
    return { svc, prisma, events, push, created };
  }

  it('never notifies the coordinator who made the change', async () => {
    const { svc, created } = setup();
    await svc.deliver({ type: 'job.status', reportId: 'r1', jobOrderId: 'j1', actorId: 'c1', status: 'DELAYED' });
    expect(created.map((c) => c.userId).sort()).toEqual(['c2', 'rep', 'rep2']);
  });

  it('the same event twice creates each notification once (no duplicate push)', async () => {
    const { svc, created, push, events } = setup();
    const e = { type: 'job.progress' as const, reportId: 'r1', jobOrderId: 'j1', actorId: 'tech', remarks: 'Pipe replaced' };
    await svc.deliver(e);
    await svc.deliver(e);
    expect(created).toHaveLength(2); // rep + rep2
    expect(push.sendToUser).toHaveBeenCalledTimes(2);
    expect(events.notification).toHaveBeenCalledTimes(2);
  });

  it('a live update goes only to the owner of each notification', async () => {
    const { svc, events } = setup();
    await svc.deliver({ type: 'report.submitted', reportId: 'r1', actorId: 'rep' });
    const owners = events.notification.mock.calls.map((c: any[]) => [c[0], c[1].userId]);
    owners.forEach(([room, owner]) => expect(room).toBe(owner));
    expect(owners.map((o) => o[0]).sort()).toEqual(['c1', 'c2', 'rep']);
  });

  it('deactivated accounts are skipped', async () => {
    const { svc, created } = setup(['rep', 'c1', 'c2', 'tech']);
    await svc.deliver({ type: 'job.status', reportId: 'r1', jobOrderId: 'j1', actorId: 'tech', status: 'IN_PROGRESS' });
    expect(created.map((c) => c.userId)).not.toContain('rep2');
  });

  it('a push failure does not stop the notification being saved', async () => {
    const { svc, created, push } = setup();
    push.sendToUser.mockRejectedValue(new Error('network down'));
    await expect(svc.deliver({ type: 'report.submitted', reportId: 'r1', actorId: 'rep' })).resolves.toBeUndefined();
    expect(created.length).toBeGreaterThan(0);
  });
});

describe('NotificationsService ownership and devices', () => {
  it("marking someone else's notification as read is a 404", async () => {
    const prisma = {
      notification: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const svc = new NotificationsService(prisma as never, {} as never, {} as never);
    await expect(svc.markRead('me', 'not-mine')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'me' }) }),
    );
  });

  it('a browser subscription needs an https endpoint and keys', async () => {
    const svc = new NotificationsService({} as never, {} as never, { status: {} } as never);
    await expect(
      svc.registerDevice('me', { platform: PushPlatform.WEB, token: 'http://insecure.example/x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a device token moves to whoever registered it last', async () => {
    const prisma = { pushDevice: { upsert: jest.fn().mockResolvedValue({}) } };
    const svc = new NotificationsService(prisma as never, {} as never, { status: { phone: true } } as never);
    await svc.registerDevice('newUser', { platform: PushPlatform.ANDROID, token: 'fcm-token-1234567890' });
    expect(prisma.pushDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'fcm-token-1234567890' }, update: expect.objectContaining({ userId: 'newUser' }) }),
    );
  });
});
