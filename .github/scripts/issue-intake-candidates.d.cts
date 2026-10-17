// Types for issue-intake-candidates.cjs, so the Vitest suite can import it.

export interface Candidate {
  number: number;
  title: string;
  body: string;
  labels: string[];
  updated_at: string | null;
  open: boolean;
}

export function buildCandidates(input: {
  issue: unknown;
  openIssues: unknown;
  closedIssues?: unknown;
  repo: unknown;
  now?: string | Date;
  max?: number;
}): Candidate[];
export function splitParents(body: unknown, repo: string, title?: string): Set<number>;
export function closedSince(now: string | Date): string;
export const MAX_CANDIDATES: number;
export const CLOSED_WINDOW_DAYS: number;
