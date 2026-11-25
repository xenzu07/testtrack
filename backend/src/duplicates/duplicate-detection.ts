// Duplicate detection: how likely two reports describe the same problem.
// Pure functions with no database access. Reports are never merged; a high
// score only creates a flag that a coordinator confirms or dismisses.
//
//   same room                 40     (same building and floor 25, same building 10)
//   same issue category       30
//   similar description       up to 30 (share of meaningful words in common)
//
//   score >= 55  -> flagged as a possible duplicate
//   score >= 75  -> "likely" duplicate
//   Different buildings are capped at 50, so they are never flagged: the
//   same kind of problem in two buildings is two problems.

export const FLAG_THRESHOLD = 55;
export const LIKELY_THRESHOLD = 75;

export interface DuplicateCandidate {
  id: string;
  categoryId: string;
  locationId: string;
  building: string;
  floor: string;
  description: string;
}

export interface SimilarityResult {
  score: number;
  reasons: string[];
  textSimilarity: number; // 0..1
}

// common words that say nothing about the problem itself
const STOPWORDS = new Set(
  (
    'the a an and or but is are was were be been it its this that there here of in on at to for ' +
    'from with by as not no yes very so too can cannot cant will would should could has have had ' +
    'our we my me i you your they them he she his her room floor building please already still ' +
    'ang ng sa na at mga po yung ung ay si ni hindi may wala'
  ).split(' '),
);

export function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    // light plural/verb trimming so "leaks", "leaking", "leaked" meet "leak"
    .map((w) => w.replace(/(ing|ed|s)$/, '') || w);
  return new Set(words.filter((w) => w.length >= 3));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

export function similarity(
  a: DuplicateCandidate,
  b: DuplicateCandidate,
): SimilarityResult {
  const reasons: string[] = [];
  let score = 0;

  const sameBuilding =
    a.building.trim().toLowerCase() === b.building.trim().toLowerCase();
  if (a.locationId === b.locationId) {
    score += 40;
    reasons.push('Same room');
  } else if (
    sameBuilding &&
    a.floor.trim().toLowerCase() === b.floor.trim().toLowerCase()
  ) {
    score += 25;
    reasons.push('Same building and floor');
  } else if (sameBuilding) {
    score += 10;
    reasons.push('Same building');
  }

  if (a.categoryId === b.categoryId) {
    score += 30;
    reasons.push('Same issue category');
  }

  const text = jaccard(tokens(a.description), tokens(b.description));
  const textPoints = Math.round(text * 30);
  if (textPoints > 0) {
    score += textPoints;
    reasons.push(
      `Similar description (${Math.round(text * 100)}% of key words shared)`,
    );
  }

  if (!sameBuilding) score = Math.min(score, 50);
  return { score: Math.min(100, score), reasons, textSimilarity: text };
}
