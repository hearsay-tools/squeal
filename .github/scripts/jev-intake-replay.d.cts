// Types for jev-intake-replay.cjs, so the Vitest suite can import it.

import type { Candidate } from "./issue-intake-candidates.cjs";
import type { JevAnswer, Thresholds } from "./jev-issue-intake.cjs";

export interface CorpusIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  created_at: string;
  closed_at: string | null;
  updated_at?: string;
  state_reason?: string | null;
}
export interface Corpus {
  repo: string;
  fetchedAt: string;
  issues: CorpusIssue[];
}
export interface RecordedAnswer {
  model: string;
  answers: Record<string, JevAnswer>;
  recheck: { numbers: number[]; answers: Record<string, JevAnswer> } | null;
}
export interface ReplayRow {
  number: number;
  title: string;
  area: string | null;
  type: string | null;
  truthAreas: string[] | null;
  outcome: string;
  expected: string;
}
export interface ReplayScore {
  issues: number;
  routed: number;
  areaRight: number;
  areaWrong: number;
  areaNone: number;
  closes: string[];
  wrongAreas: string[];
  rightCloses: number;
  wrongCloses: number[];
  rightComments: number;
  wrongComments: number[];
  missed: number[];
}

export function specAreas(criteria?: Record<string, string>): Map<string, string>;
export function boardTruth(board: string, areas?: Map<string, string>): Map<number, Set<string>>;
export function candidatesAt(corpus: Corpus, target: CorpusIssue): Candidate[];
export function evaluate(input: {
  corpus: Corpus;
  answers: Record<number, RecordedAnswer>;
  truth: Map<number, Set<string>>;
  thresholds?: Thresholds;
}): ReplayRow[];
export function score(rows: ReplayRow[]): ReplayScore;
export function render(input: {
  corpus: Corpus;
  rows: ReplayRow[];
  model: string;
  command: string;
}): string;
export function COMMAND(dir: string): string;
export const DUPLICATES: Readonly<Record<number, number>>;
