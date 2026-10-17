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
  evidence: string | null;
  merged: boolean;
}
export interface BoardTruth {
  areas: Map<number, Set<string>>;
  rows: Map<number, Set<string>>;
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
  merged: string[];
  missed: number[];
}

export function specAreas(criteria?: Record<string, string>): Map<string, string>;
export function boardTruth(board: string, specToArea?: Map<string, string>): BoardTruth;
export function candidatesAt(corpus: Corpus, target: CorpusIssue): Candidate[];
export function evaluate(input: {
  corpus: Corpus;
  answers: Record<number, RecordedAnswer>;
  truth: BoardTruth;
  thresholds?: Thresholds;
}): ReplayRow[];
export function COMMAND(dir: string): string;
export const DUPLICATES: Readonly<Record<number, number>>;
