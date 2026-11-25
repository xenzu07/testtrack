// Priority scoring: turns what a report says into a 0-100 score and a level.
// The reporter does not choose an urgency; the system decides it from facts
// it can check. Urgency and priority are one value: Report.urgency is kept
// in step with the priority (P1 = Critical ... P4 = Low).
// Pure functions with no database access, so the rules can be tested and
// explained. Inputs and points:
//
//   category severity (1-4)      6, 14, 22, 30                            max 30
//   safety hazard                yes: 30                                  max 30
//   room/facility unusable       yes: 15                                  max 15
//   people affected              just me 0, 2-10: 5, 11-50: 10, 50+: 15   max 15
//   other reports of the same    1 more: 5, 2 or more: 10                 max 10
//   problem (confirmed links)
//
// Levels:  P1 Critical >= 70   P2 High >= 50   P3 Medium >= 30   P4 Low < 30
// A reported safety hazard is never below P2.
//
// Who reported (student, faculty, staff) is deliberately NOT a factor: the
// impact on people is captured by "people affected", so no group's reports
// are ranked lower because of who sent them.
//
// Examples:
//   Faulty wiring (sev 4), hazard, usable, 11-50 people        30+30+0+10   = 70  -> P1
//   Water leak (sev 3), no hazard, unusable, 2-10 people       22+0+15+5    = 42  -> P3
//   Clogged toilet (sev 3), no hazard, unusable, 50+ people    22+0+15+15   = 52  -> P2
//   Damaged chair (sev 1), no hazard, usable, just me          6            = 6   -> P4

import { Urgency } from '@prisma/client';

export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4';

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Medium',
  P4: 'Low',
};

export const THRESHOLDS = { P1: 70, P2: 50, P3: 30 } as const;

// the single level, written as an urgency word (stored in Report.urgency and
// copied onto signed Job Order Forms)
export const URGENCY_FOR_LEVEL: Record<PriorityLevel, Urgency> = {
  P1: 'CRITICAL',
  P2: 'HIGH',
  P3: 'MEDIUM',
  P4: 'LOW',
};

const SEVERITY_POINTS = [0, 6, 14, 22, 30]; // index = severity 1..4
const PEOPLE_POINTS = [0, 5, 10, 15]; // index = affectedPeople 0..3
export const PEOPLE_LABEL = [
  'Just the reporter',
  '2 to 10 people',
  '11 to 50 people',
  'More than 50 people',
];

// Reasons the algorithm asks a coordinator to look before trusting it.
export const REVIEW_FLAG_LABEL = {
  impact_missing: 'Impact questions were not answered (older app version)',
  possible_duplicate: 'May be the same problem as another report',
} as const;
export type ReviewFlag = keyof typeof REVIEW_FLAG_LABEL;

export interface PriorityInput {
  categorySeverity: number; // 1-4
  affectedPeople: number | null; // 0-3
  safetyHazard: boolean | null;
  blocksUse: boolean | null;
  corroboratingReports: number; // other reports confirmed as the same problem
}

export interface PriorityFactor {
  key: string;
  label: string;
  value: string;
  points: number;
  max: number;
}

export interface PriorityResult {
  score: number;
  level: PriorityLevel;
  factors: PriorityFactor[];
  flags: ReviewFlag[];
}

const clamp = (n: number, min: number, max: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : min;

export function levelFor(score: number): PriorityLevel {
  if (score >= THRESHOLDS.P1) return 'P1';
  if (score >= THRESHOLDS.P2) return 'P2';
  if (score >= THRESHOLDS.P3) return 'P3';
  return 'P4';
}

export function scorePriority(input: PriorityInput): PriorityResult {
  const severity = clamp(input.categorySeverity, 1, 4);
  const people =
    input.affectedPeople === null ? null : clamp(input.affectedPeople, 0, 3);
  const corroboration = clamp(input.corroboratingReports, 0, 1000);
  const yesNo = (v: boolean | null) =>
    v === null ? 'Not answered' : v ? 'Yes' : 'No';

  const factors: PriorityFactor[] = [
    {
      key: 'severity',
      label: 'Category severity',
      value: `${severity} of 4`,
      points: SEVERITY_POINTS[severity],
      max: 30,
    },
    {
      key: 'safetyHazard',
      label: 'Safety hazard',
      value: yesNo(input.safetyHazard),
      points: input.safetyHazard ? 30 : 0,
      max: 30,
    },
    {
      key: 'blocksUse',
      label: 'Room or facility unusable',
      value: yesNo(input.blocksUse),
      points: input.blocksUse ? 15 : 0,
      max: 15,
    },
    {
      key: 'affectedPeople',
      label: 'People affected',
      value: people === null ? 'Not answered' : PEOPLE_LABEL[people],
      points: people === null ? 0 : PEOPLE_POINTS[people],
      max: 15,
    },
    {
      key: 'corroboration',
      label: 'Other reports of the same problem',
      value: String(corroboration),
      points: corroboration >= 2 ? 10 : corroboration === 1 ? 5 : 0,
      max: 10,
    },
  ];

  const score = Math.min(
    100,
    factors.reduce((sum, f) => sum + f.points, 0),
  );
  let level = levelFor(score);
  // a hazard to people is never treated as routine
  if (input.safetyHazard && (level === 'P3' || level === 'P4')) level = 'P2';

  const flags: ReviewFlag[] = [];
  if (
    input.affectedPeople === null ||
    input.safetyHazard === null ||
    input.blocksUse === null
  ) {
    flags.push('impact_missing');
  }

  return { score, level, factors, flags };
}
