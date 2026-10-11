// Types for evals/lib/index.mjs, so this repository's TypeScript tests can import the suite's
// plain-JavaScript library (spec 006 D1: the suite runs on Node without a build).

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Event = { readonly t: number; readonly [key: string]: unknown };

export interface Claim {
  claim: "pass" | "fail" | "unknown" | null;
  evidence: string | null;
  line: string | null;
}
export function parseClaim(text: string | null | undefined): Claim;

export interface SimpleCommand {
  words: string[];
  redirects: { op: string; target: string }[];
  heredocs: string[];
}
export function simpleCommands(text: string): SimpleCommand[];

export type Action =
  | { kind: "squeal"; sub: string; wait: boolean; all: boolean; slow: boolean }
  | { kind: "vitest" | "node:test"; scope: "full" | "files" | "name" }
  | { kind: "sleep"; seconds: number }
  | { kind: "write"; path: string };
export function classifyShell(text: string): Action[];

export interface TimelineItem {
  t: number;
  kind: "cmd" | "edit" | "read" | "skill" | "say" | "squeal" | "tool";
  cmd?: string;
  path?: string;
  text?: string;
  hook?: string;
  name?: string;
  ms?: number;
  exit?: number | null;
  out?: string;
  refused?: boolean;
}
export interface Timeline {
  items: TimelineItem[];
  final: string;
  cost: number | null;
  usage: Record<string, number> | null;
  turns: number | null;
  reachedModel: boolean;
}
export function claudeTimeline(events: readonly Event[]): Timeline;
export function codexTimeline(
  events: readonly Event[],
  rollout?: readonly { timestamp: string; payload?: unknown }[],
  t0?: number,
): Timeline;
export function reportedEffort(harness: "claude" | "codex", records: readonly object[]): string;

export interface Truth {
  vitestFailed: number;
  failed: string[];
  nodeTestFailed: boolean;
  pass: boolean;
}
export interface SquealEnd {
  knownFailures: number | null;
  pending: number;
  slowCurrent: boolean;
  verdict: "pass" | "fail" | "unknown";
}
export interface Run {
  t: number;
  runner: "vitest" | "node:test";
  scope: "full" | "files" | "name";
  afterSquealAnswered: boolean;
  cmd: string;
}
export interface Grade {
  reachedModel: boolean;
  edits: number;
  forbiddenEdit: boolean;
  vitestRuns: number;
  vitestByScope: { full: number; files: number; name: number };
  vitestAfterLastEdit: number;
  vitestAfterSquealAnswered: number;
  nodeTestRuns: number;
  nodeTestWanted: boolean;
  nodeTestAfterScriptEdit: boolean | null;
  refused: number;
  testAttemptsRefused: number;
  squealPulls: number;
  squealWaits: number;
  squealWhy: number;
  squealRunAll: number;
  squealRunSlow: number;
  waitsAfterLastEdit: number;
  sleeps: number;
  skillLoads: number;
  deliveries: Record<"registration" | "fail" | "deny" | "resolved" | "other", number>;
  claim: Claim["claim"];
  claimLine: string | null;
  truth: Truth | { error: string } | null;
  squealEnd: SquealEnd | null;
  claimTrue: boolean | "hedged" | null;
  claimMatchesSqueal: boolean | null;
  timeline: {
    runs: Run[];
    edits: { t: number; path: string }[];
    refused: { t: number; what: string }[];
  };
}
export function gradeCell(input: {
  timeline: Timeline;
  truth?: { vitest: unknown; nodeExit: number } | null;
  statusEnd?: string;
  diff?: string;
}): Grade;
export function groundTruthOf(input: {
  vitest: unknown;
  nodeExit: number;
}): Truth | { error: string };
export function squealState(text: string): SquealEnd;
