// Turns one trade unit's survey answers into a 0-100 score and a yes/no
// qualification. Pure functions with no database access, so the rules are
// easy to test and to explain to staff.
//
//   proficiency  None..Expert (0-4)        up to 50 points
//   experience   <1 / 1-2 / 3-5 / 5+ yrs   0, 8, 16 or 25 points
//   tasks        share of the checklist    up to 25 points
//                (no checklist for the trade unit: proficiency counts here too)
//   certified    formal training/licence   +10 bonus (score is capped at 100)
//
// Qualified = proficiency is at least Intermediate AND score is at least 50.
// Examples:
//   Intermediate, 3-5 years, 3 of 5 tasks         25 + 16 + 15      = 56 -> qualified
//   Basic, 5+ years, all tasks, certified         12.5 + 25 + 25 + 10 = 73 -> not (only Basic)
//   Advanced, under 1 year, 1 of 5 tasks          37.5 + 0 + 5      = 43 -> not (score < 50)

export const QUALIFY_MIN_SCORE = 50;
export const QUALIFY_MIN_PROFICIENCY = 2;
const EXPERIENCE_POINTS = [0, 8, 16, 25];

export interface UnitAnswer {
  proficiency: number; // 0-4
  experience: number; // 0-3
  certified: boolean;
  tasks: string[]; // ids of checked tasks
}

export interface UnitResult {
  score: number;
  qualified: boolean;
}

export function scoreUnit(answer: UnitAnswer, taskIds: string[]): UnitResult {
  const proficiency = clamp(Math.trunc(answer.proficiency), 0, 4);
  if (proficiency === 0) return { score: 0, qualified: false };

  const experience = clamp(Math.trunc(answer.experience), 0, 3);
  const known = new Set(taskIds);
  const checked = new Set(answer.tasks.filter((t) => known.has(t))).size;

  const profPts = (proficiency / 4) * 50;
  const expPts = EXPERIENCE_POINTS[experience];
  const taskPts =
    taskIds.length > 0 ? (checked / taskIds.length) * 25 : (proficiency / 4) * 25;
  const certPts = answer.certified ? 10 : 0;

  const score = Math.min(100, Math.round(profPts + expPts + taskPts + certPts));
  return {
    score,
    qualified: proficiency >= QUALIFY_MIN_PROFICIENCY && score >= QUALIFY_MIN_SCORE,
  };
}

function clamp(n: number, min: number, max: number) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
