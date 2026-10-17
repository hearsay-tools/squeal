// Types for jev-intake-replay-report.cjs, so the Vitest suite can import it.

import type { Corpus, ReplayRow, ReplayScore } from "./jev-intake-replay.cjs";

export function score(rows: ReplayRow[]): ReplayScore;
export function render(input: {
  corpus: Corpus;
  rows: ReplayRow[];
  model: string;
  command: string;
}): string;
