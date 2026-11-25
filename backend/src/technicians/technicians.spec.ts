import { BadRequestException, ConflictException } from '@nestjs/common';
import { scoreUnit } from './survey-scoring';
import { tasksFor } from './survey-definition';
import { TechniciansService } from './technicians.service';

const five = ['a', 'b', 'c', 'd', 'e'];

describe('scoreUnit', () => {
  it('matches the documented examples', () => {
    expect(scoreUnit({ proficiency: 2, experience: 2, certified: false, tasks: ['a', 'b', 'c'] }, five))
      .toEqual({ score: 56, qualified: true });
    // high score but only Basic proficiency: not qualified
    expect(scoreUnit({ proficiency: 1, experience: 3, certified: true, tasks: five }, five))
      .toEqual({ score: 73, qualified: false });
    // Advanced but little experience and few tasks: score below 50
    expect(scoreUnit({ proficiency: 3, experience: 0, certified: false, tasks: ['a'] }, five))
      .toEqual({ score: 43, qualified: false });
  });

  it('gives 0 when the technician does not do this work at all', () => {
    expect(scoreUnit({ proficiency: 0, experience: 3, certified: true, tasks: five }, five))
      .toEqual({ score: 0, qualified: false });
  });

  it('caps at 100 and ignores unknown or repeated tasks', () => {
    expect(scoreUnit({ proficiency: 4, experience: 3, certified: true, tasks: five }, five).score).toBe(100);
    const r = scoreUnit({ proficiency: 2, experience: 0, certified: false, tasks: ['a', 'a', 'zzz'] }, five);
    expect(r.score).toBe(30); // 25 + 0 + 1/5*25
  });

  it('scores proficiency in place of tasks when a trade unit has no checklist', () => {
    expect(scoreUnit({ proficiency: 2, experience: 1, certified: false, tasks: [] }, []))
      .toEqual({ score: 46, qualified: false }); // 25 + 8 + 12.5
    expect(scoreUnit({ proficiency: 3, experience: 1, certified: false, tasks: [] }, []).qualified).toBe(true);
  });

  it('clamps out-of-range values instead of crashing', () => {
    expect(scoreUnit({ proficiency: 9, experience: -4, certified: false, tasks: [] }, []).score).toBe(75);
  });
});

describe('TechniciansService.submitSurvey', () => {
  const units = [
    { id: 'u-plumb', name: 'Plumbing' },
    { id: 'u-elec', name: 'Electrical' },
    { id: 'u-mason', name: 'Masonry' },
  ];
  const plumbTasks = tasksFor('Plumbing').map((t) => t.id);
  const elecTasks = tasksFor('Electrical').map((t) => t.id);

  function setup(recent: unknown = null) {
    const prisma = {
      tradeUnit: { findMany: jest.fn().mockResolvedValue(units) },
      technicianSurvey: {
        findFirst: jest.fn().mockResolvedValue(recent),
        create: jest.fn((x) => ({ op: 'createSurvey', ...x })),
      },
      technicianRole: {
        deleteMany: jest.fn((x) => ({ op: 'deleteRoles', ...x })),
        createMany: jest.fn((x) => ({ op: 'createRoles', ...x })),
      },
      user: { update: jest.fn((x) => ({ op: 'markDone', ...x })) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { prisma, svc: new TechniciansService(prisma as never) };
  }

  const answers = [
    { tradeUnitId: 'u-plumb', proficiency: 3, experience: 2, certified: true, tasks: plumbTasks },
    { tradeUnitId: 'u-elec', proficiency: 2, experience: 2, certified: false, tasks: elecTasks.slice(0, 3) },
    { tradeUnitId: 'u-mason', proficiency: 0, experience: 3, certified: true, tasks: ['masonry.patch'] },
  ];

  it('assigns every qualifying trade unit as a role (Plumbing + Electrical)', async () => {
    const { prisma, svc } = setup();
    const res = await svc.submitSurvey('tech1', { answers });

    expect(res.roles.map((r) => r.tradeUnit.name)).toEqual(['Plumbing', 'Electrical']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // old roles are replaced, not merged
    expect(prisma.technicianRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'tech1' } });
    const created = prisma.technicianRole.createMany.mock.calls[0][0].data;
    expect(created.map((r: { tradeUnitId: string }) => r.tradeUnitId)).toEqual(['u-plumb', 'u-elec']);
    // "None" answers are stored without stray details
    const stored = prisma.technicianSurvey.create.mock.calls[0][0].data.answers.units;
    expect(stored[2]).toEqual({ tradeUnitId: 'u-mason', proficiency: 0, experience: 0, certified: false, tasks: [] });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tech1' } }),
    );
  });

  it('stores no roles when nothing qualifies, but still marks the survey done', async () => {
    const { prisma, svc } = setup();
    const none = answers.map((a) => ({ ...a, proficiency: 1 }));
    const res = await svc.submitSurvey('tech1', { answers: none });
    expect(res.roles).toEqual([]);
    expect(prisma.technicianRole.createMany.mock.calls[0][0].data).toEqual([]);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('requires every trade unit exactly once', async () => {
    const { svc } = setup();
    await expect(svc.submitSurvey('t', { answers: answers.slice(0, 2) })).rejects.toThrow(
      /Missing: Masonry/,
    );
    await expect(
      svc.submitSurvey('t', { answers: [...answers, answers[0]] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.submitSurvey('t', {
        answers: [...answers, { ...answers[0], tradeUnitId: 'u-unknown' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a second submission within seconds (double tap)', async () => {
    const { prisma, svc } = setup({ id: 'just-now' });
    await expect(svc.submitSurvey('t', { answers })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
