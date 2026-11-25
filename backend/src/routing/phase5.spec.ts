import { ConflictException } from '@nestjs/common';
import { DuplicateStatus } from '@prisma/client';
import { URGENCY_FOR_LEVEL, levelFor, scorePriority } from '../priority/priority-scoring';
import { PriorityService } from '../priority/priority.service';
import { similarity, tokens } from '../duplicates/duplicate-detection';
import { DuplicatesService } from '../duplicates/duplicates.service';
import { rankTechnicians, recommended } from './assignment-recommender';

const base = {
  categorySeverity: 2,
  affectedPeople: 0,
  safetyHazard: false,
  blocksUse: false,
  corroboratingReports: 0,
};

describe('priority scoring (system-set; the reporter chooses no urgency)', () => {
  it('matches the documented examples', () => {
    const wiring = scorePriority({ ...base, categorySeverity: 4, safetyHazard: true, affectedPeople: 2 });
    expect([wiring.score, wiring.level]).toEqual([70, 'P1']);
    const leak = scorePriority({ ...base, categorySeverity: 3, blocksUse: true, affectedPeople: 1 });
    expect([leak.score, leak.level]).toEqual([42, 'P3']);
    const toilet = scorePriority({ ...base, categorySeverity: 3, blocksUse: true, affectedPeople: 3 });
    expect([toilet.score, toilet.level]).toEqual([52, 'P2']);
    const chair = scorePriority({ ...base, categorySeverity: 1 });
    expect([chair.score, chair.level]).toEqual([6, 'P4']);
  });

  it('uses the level thresholds 70 / 50 / 30', () => {
    expect([levelFor(100), levelFor(70), levelFor(69), levelFor(50), levelFor(49), levelFor(30), levelFor(29), levelFor(0)])
      .toEqual(['P1', 'P1', 'P2', 'P2', 'P3', 'P3', 'P4', 'P4']);
  });

  it('never puts a safety hazard below P2', () => {
    const r = scorePriority({ ...base, categorySeverity: 1, safetyHazard: true });
    expect(r.score).toBe(36);
    expect(r.level).toBe('P2');
  });

  it('caps at 100 and counts confirmed duplicate reports', () => {
    const max = { ...base, categorySeverity: 4, safetyHazard: true, blocksUse: true, affectedPeople: 3 };
    expect(scorePriority({ ...max, corroboratingReports: 9 }).score).toBe(100);
    expect(scorePriority({ ...base, corroboratingReports: 1 }).score - scorePriority(base).score).toBe(5);
    expect(scorePriority({ ...base, corroboratingReports: 4 }).score - scorePriority(base).score).toBe(10);
  });

  it('asks for a check only when the impact answers are missing', () => {
    expect(scorePriority({ ...base, affectedPeople: null }).flags).toEqual(['impact_missing']);
    expect(scorePriority({ ...base, categorySeverity: 4, safetyHazard: true }).flags).toEqual([]);
    expect(scorePriority(base).flags).toEqual([]);
  });

  it('explains itself: factor points add up to the score, and there is no urgency factor', () => {
    const r = scorePriority({ ...base, categorySeverity: 3, blocksUse: true, affectedPeople: 3 });
    expect(r.factors.reduce((s, f) => s + f.points, 0)).toBe(r.score);
    expect(r.factors.map((f) => f.max).reduce((a, b) => a + b, 0)).toBe(100);
    expect(r.factors.map((f) => f.key)).not.toContain('urgency');
  });

  it('writes the same level as the urgency word', () => {
    expect(URGENCY_FOR_LEVEL).toEqual({ P1: 'CRITICAL', P2: 'HIGH', P3: 'MEDIUM', P4: 'LOW' });
  });
});

describe('duplicate detection', () => {
  const r = (over: Partial<Parameters<typeof similarity>[0]>) => ({
    id: 'x',
    categoryId: 'leak',
    locationId: 'sci-2-101',
    building: 'Science Building',
    floor: '2nd Floor',
    description: 'Water is leaking from the ceiling pipe',
    ...over,
  });

  it('same room, same category, same words: very likely', () => {
    const s = similarity(r({}), r({ id: 'y', description: 'Ceiling pipe leaks water' }));
    expect(s.score).toBeGreaterThanOrEqual(75);
    expect(s.reasons).toEqual(expect.arrayContaining(['Same room', 'Same issue category']));
  });

  it('same floor and category with similar words is flagged', () => {
    expect(similarity(r({}), r({ id: 'y', locationId: 'sci-2-cr', description: 'pipe leaking near ceiling' })).score)
      .toBeGreaterThanOrEqual(55);
  });

  it('different buildings are never flagged, however similar', () => {
    expect(similarity(r({}), r({ id: 'y', locationId: 'main-2-101', building: 'Main Building' })).score).toBeLessThan(55);
  });

  it('same room but unrelated problem is not flagged', () => {
    expect(similarity(r({}), r({ id: 'y', categoryId: 'chair', description: 'Broken chair leg near the door' })).score)
      .toBeLessThan(55);
  });

  it('normalises words', () => {
    expect([...tokens('Leaking LEAKS leaked, the pipes!')].sort()).toEqual(['leak', 'pipe']);
  });
});

describe('assignment recommendation', () => {
  const tech = (id: string, active: number, opts: { primary?: boolean; survey?: number | null; delayed?: number } = {}) => ({
    id,
    fullName: id,
    tradeUnit: { id: 'u', name: 'Plumbing' },
    workload: { active, delayed: opts.delayed ?? 0 },
    match: { primary: opts.primary ?? true, surveyScore: opts.survey ?? null },
  });

  it('prefers the least busy qualified technician', () => {
    const ranked = rankTechnicians([tech('busy', 3), tech('free', 0), tech('some', 1)]);
    expect(ranked.map((t) => t.id)).toEqual(['free', 'some', 'busy']);
    expect(recommended(ranked)?.id).toBe('free');
  });

  it('weighs survey-qualified technicians by their score', () => {
    const ranked = rankTechnicians([tech('primary-busy', 2), tech('survey-90', 0, { primary: false, survey: 90 })]);
    expect(ranked[0].id).toBe('survey-90'); // 45 vs 50 - 24 = 26
    expect(ranked[0].reasons[0]).toContain('skills survey');
  });

  it('never recommends someone who declined this job', () => {
    const ranked = rankTechnicians([tech('declined', 0), tech('other', 2)], new Set(['declined']));
    expect(ranked.map((t) => t.id)).toEqual(['other', 'declined']);
    expect(recommended(ranked)?.id).toBe('other');
    expect(recommended(rankTechnicians([tech('only', 0)], new Set(['only'])))).toBeNull();
  });

  it('delayed jobs count against availability', () => {
    expect(rankTechnicians([tech('a', 1, { delayed: 1 }), tech('b', 1)])[0].id).toBe('b');
  });
});

describe('PriorityService.recalculate review logic', () => {
  function setup(report: Record<string, unknown>) {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      report: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'SUBMITTED',
          jobOrder: null,
          urgency: 'MEDIUM',
          affectedPeople: 0,
          safetyHazard: false,
          blocksUse: false,
          priority: null,
          priorityLocked: false,
          reviewFlags: [],
          needsReview: false,
          category: { severity: 2 },
          _count: { duplicates: 0, duplicateFlags: 0 },
          ...report,
        }),
        update,
      },
    };
    return { svc: new PriorityService(prisma as never), update };
  }

  it('asks for review when a new reason appears', async () => {
    const { svc, update } = setup({ _count: { duplicates: 0, duplicateFlags: 1 } });
    await svc.recalculate('r1');
    expect(update.mock.calls[0][0].data).toMatchObject({ reviewFlags: ['possible_duplicate'], needsReview: true, priority: 'P4' }); // 12 + 10 = 22
  });

  it('does not ask again for a reason the coordinator already reviewed', async () => {
    const { svc, update } = setup({ reviewFlags: ['possible_duplicate'], needsReview: false, _count: { duplicates: 0, duplicateFlags: 1 } });
    await svc.recalculate('r1');
    expect(update.mock.calls[0][0].data.needsReview).toBe(false);
  });

  it('keeps a coordinator override but still updates the automatic level', async () => {
    const { svc, update } = setup({ priorityLocked: true, priority: 'P1' });
    await svc.recalculate('r1');
    expect(update.mock.calls[0][0].data).toMatchObject({ priority: 'P1', autoPriority: 'P4' });
  });

  it('stores flags but does not ask for review once the report has a job order', async () => {
    const { svc, update } = setup({ status: 'CLOSED', jobOrder: { id: 'j1' }, affectedPeople: null });
    await svc.recalculate('r1');
    expect(update.mock.calls[0][0].data).toMatchObject({ reviewFlags: ['impact_missing'], needsReview: false });
  });

  it('an override needs a reason', async () => {
    const { svc } = setup({});
    await expect(svc.adjust('r1', 'c1', 'P1', 'no')).rejects.toThrow(/reason/);
  });
});

describe('DuplicatesService.decide', () => {
  it('a flag can only be decided once', async () => {
    const tx = { duplicateFlag: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const prisma = {
      duplicateFlag: {
        findUnique: jest.fn().mockResolvedValue({ id: 'f1', reportId: 'r2', candidateId: 'r1', status: DuplicateStatus.CONFIRMED }),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const svc = new DuplicatesService(prisma as never, {} as never, {} as never, { emit: jest.fn(), emitPriorityReview: jest.fn() } as never);
    await expect(svc.decide('r2', 'f1', 'c1', 'dismiss')).rejects.toBeInstanceOf(ConflictException);
  });
});
