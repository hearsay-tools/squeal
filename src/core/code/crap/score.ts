/*
 * Spec 015 D9: the CRAP score of one function, after Savoia (2007) and
 * PHPUnit's `CrapIndex`: `CC² × (1 − cov)³ + CC`, with cov the share of the
 * function's own statements that ran, 0 to 1. A cov of 95% or more gives CC.
 */

/** PHPUnit's rule: at this share or above, the score is the complexity alone. */
export const FULL_COVERAGE = 0.95;

export function crapScore(complexity: number, coverage: number): number {
  if (coverage >= FULL_COVERAGE) return complexity;
  const missed = 1 - Math.max(0, coverage);
  return complexity ** 2 * missed ** 3 + complexity;
}
