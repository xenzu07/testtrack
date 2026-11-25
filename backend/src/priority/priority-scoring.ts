// Priority scoring: turns what a report says into a 0-100 score and a level.
// Pure functions with no database access, so the rules can be tested and
// explained. Inputs and points:
//
//   urgency (reporter's choice)  Low 5, Medium 12, High 20, Critical 30   max 30
//   category severity (1-4)      5, 10, 15, 20                            max 20
//   safety hazard                yes: 20                                  max 20
//   room/facility unusable       yes: 10                                  max 10
//   people affected              just me 0, 2-10: 5, 11-50: 10, 50+: 15   max 15
//   other reports of the same    1 more: 3, 2 or more: 5                  max 5
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
//   Faulty wiring (sev 4), High, hazard, usable, 11-50 people  20+20+20+0+10 = 70  -> P1
//   Water leak (sev 3), Medium, no hazard, unusable, 2-10       15+12+0+10+5  = 42  -> P3
//   Damaged chair (sev 1), Low, no hazard, usable, just me       5+5           = 10  -> P4

import { Urgency } from '@prisma/client';

export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4';

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Medium',
  P4: 'Low',
};

export const THRESHOLDS = { P1: 70, P2: 50, P3: 30 } as const;

const URGENCY_POINTS: Record<Urgency, number> = {
  LOW: 5,
  MEDIUM: 12,
  HIGH: 20,
  CRITICAL: 30,
};
const SEVERITY_POINTS = [0, 5, 10, 15, 20]; // index = severity 1..4
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
  urgency_overstated:
    'Marked Critical, but no hazard, the area is usable and the category is minor',
  hazard_low_urgency: 'Safety hazard reported, but urgency was set to Low',
  dangerous_category_low_urgency:
    'Usually dangerous kind of problem, but urgency was set to Low',
  possible_duplicate: 'May be the same problem as another report',
} as const;
export type ReviewFlag = keyof typeof REVIEW_FLAG_LABEL;

export interface PriorityInput {
  urgency: Urgency;
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
      key: 'urgency',
      label: 'Urgency (reporter)',
      value: input.urgency.charAt(0) + input.urgency.slice(1).toLowerCase(),
      points: URGENCY_POINTS[input.urgency],
      max: 30,
    },
    {
      key: 'severity',
      label: 'Category severity',
      value: `${severity} of 4`,
      points: SEVERITY_POINTS[severity],
      max: 20,
    },
    {
      key: 'safetyHazard',
      label: 'Safety hazard',
      value: yesNo(input.safetyHazard),
      points: input.safetyHazard ? 20 : 0,
      max: 20,
    },
    {
      key: 'blocksUse',
      label: 'Room or facility unusable',
      value: yesNo(input.blocksUse),
      points: input.blocksUse ? 10 : 0,
      max: 10,
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
      points: corroboration >= 2 ? 5 : corroboration === 1 ? 3 : 0,
      max: 5,
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
  if (
    input.urgency === 'CRITICAL' &&
    input.safetyHazard === false &&
    input.blocksUse === false &&
    severity <= 2
  ) {
    flags.push('urgency_overstated');
  }
  if (input.safetyHazard === true && input.urgency === 'LOW')
    flags.push('hazard_low_urgency');
  if (
    severity === 4 &&
    input.urgency === 'LOW' &&
    input.safetyHazard !== true
  ) {
    flags.push('dangerous_category_low_urgency');
  }

  return { score, level, factors, flags };
}
