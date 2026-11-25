// Assignment recommendation: ranks the technicians qualified for a job.
// Pure function with no database access. It only suggests: the coordinator
// always confirms or picks someone else.
//
//   qualification   assigned trade unit: 50 points;
//                   role from the skills survey: survey score / 2 (25-50)
//   workload        -12 per active job (assigned, in progress or delayed),
//                   -6 more per delayed job (often stuck waiting)
//   declined        technicians who already declined this job are listed
//                   last and never recommended
//
// Ties: fewer active jobs first, then name.

export interface RecommendationInput {
  id: string;
  fullName: string;
  tradeUnit: { id: string; name: string } | null;
  workload: { active: number; delayed: number };
  match?: { primary: boolean; surveyScore: number | null };
}

export interface RankedTechnician {
  id: string;
  fullName: string;
  score: number;
  declinedThisJob: boolean;
  reasons: string[];
}

export function rankTechnicians(
  technicians: RecommendationInput[],
  declinedIds: ReadonlySet<string> = new Set(),
): RankedTechnician[] {
  const ranked = technicians.map((t) => {
    const reasons: string[] = [];
    let qualification = 0;
    if (t.match?.primary) {
      qualification = 50;
      reasons.push(`Assigned to ${t.tradeUnit?.name ?? 'this trade unit'}`);
    } else if (t.match?.surveyScore != null) {
      qualification = Math.round(t.match.surveyScore / 2);
      reasons.push(`Qualified by skills survey (score ${t.match.surveyScore})`);
    }
    const { active, delayed } = t.workload;
    reasons.push(
      active === 0
        ? 'No active jobs'
        : `${active} active job${active === 1 ? '' : 's'}`,
    );
    if (delayed) reasons.push(`${delayed} delayed`);
    const declinedThisJob = declinedIds.has(t.id);
    if (declinedThisJob) reasons.push('Declined this job before');

    return {
      id: t.id,
      fullName: t.fullName,
      score: qualification - active * 12 - delayed * 6,
      declinedThisJob,
      reasons,
      active,
    };
  });

  return ranked
    .sort(
      (a, b) =>
        Number(a.declinedThisJob) - Number(b.declinedThisJob) ||
        b.score - a.score ||
        a.active - b.active ||
        a.fullName.localeCompare(b.fullName),
    )
    .map(({ active: _active, ...rest }) => rest);
}

export function recommended(
  ranked: RankedTechnician[],
): RankedTechnician | null {
  return ranked.find((t) => !t.declinedThisJob) ?? null;
}
