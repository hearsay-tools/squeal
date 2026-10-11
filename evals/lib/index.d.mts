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
  established: boolean;
}
export function simpleCommands(text: string, options?: { exit?: number | null }): SimpleCommand[];

export type Execution = "executed" | "refused" | "indeterminate";
export type Action = (
  | { kind: "squeal"; sub: string; wait: boolean; all: boolean; slow: boolean }
  | { kind: "vitest" | "node:test"; scope: "full" | "files" | "name" }
  | { kind: "sleep"; seconds: number }
  | { kind: "write"; path: string }
) & { execution: Execution };
export function classifyShell(
  text: string,
  options?: { exit?: number | null; output?: string; refused?: boolean },
): Action[];

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
  failed?: boolean;
  background?: boolean;
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
  vitestExit: number;
  nodeTestExit: number;
  pass: boolean;
}
/** One command's completion in `out/truth.json` (spec 006 wave 1.5). */
export interface Completion {
  exit: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError: string | null;
}
export interface TruthRecord {
  vitest: Completion;
  nodeTest: Completion & { files: number };
}
export interface SquealEnd {
  knownFailures: number | null;
  pending: number;
  slowCurrent: boolean;
  daemon: boolean;
  verdict: "pass" | "fail" | "unknown";
  /** `false` when the status was missing, unparsable or outside the contract. */
  supported: boolean;
  /** Why the verdict is not `pass`, other than known failures. */
  reasons: string[];
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
  failedEdits: number;
  indeterminate: number;
  testAttemptsRefused: number;
  squealPulls: number;
  squealWaits: number;
  squealWhy: number;
  squealRunAll: number;
  squealRunSlow: number;
  waitsAfterLastEdit: number;
  sleeps: number;
  skillLoads: number;
  deliveries: Record<"registration" | "fail" | "deny" | "resolved" | "noDaemon" | "other", number>;
  claim: Claim["claim"];
  claimLine: string | null;
  truth: Truth | { error: string } | null;
  squealEnd: SquealEnd | null;
  claimTrue: boolean | "hedged" | null;
  /** `pass` while ground truth fails; `null` where `claimTrue` is. */
  falsePass: boolean | null;
  /** `fail` while ground truth passes; `null` where `claimTrue` is. */
  falseFail: boolean | null;
  claimMatchesSqueal: boolean | null;
  timeline: {
    runs: Run[];
    edits: { t: number; path: string }[];
    failedEdits: { t: number; path: string }[];
    refused: { t: number; what: string }[];
    indeterminate: { t: number; what: string; cmd: string }[];
  };
}
export function gradeCell(input: {
  timeline: Timeline;
  /** `completion` is `out/truth.json`, checked before it is trusted. */
  truth?: { vitest: unknown; completion: unknown } | null;
  /** `squeal status --json` after the session, as text or parsed. */
  statusEnd?: unknown;
  /** Whether the cell had the plugin; without it Squeal's state does not apply. */
  plugin?: boolean;
  diff?: string;
}): Grade;
export function groundTruthOf(input: {
  vitest: unknown;
  completion: unknown;
}): Truth | { error: string };
export function squealState(status: unknown): SquealEnd;

export function daemonPids(root: string): number[];
export function waitForExit(
  pids: readonly number[],
  ms?: number,
): Promise<{ pid: number; exitedMs: number; signal: "SIGTERM" | "SIGKILL" | null }[]>;

export function cellEnv(
  parent: Record<string, string | undefined>,
  cell: string,
  provider?: readonly string[],
): Record<string, string | undefined>;
export function providerVariables(
  harness: "claude" | "codex",
  parent: Record<string, string | undefined>,
  realCodexConfig?: string,
): string[];
export function codexConfig(realConfig: string, model: string): string;
export function secretsOf(
  env: Record<string, string | undefined>,
  realCodexConfig?: string,
): string[];
export function scanForSecrets(
  dirs: readonly string[],
  secrets: readonly string[],
): { path: string; secrets: number; unscanned?: true }[];
export function redact(text: string, secrets: readonly string[]): string;
export interface ScratchReport {
  secretsBeforeRemoval: string[];
  sanitized: string[];
  removed: string[];
  secretsAfterRemoval: string[];
}
export function clearScratch(cell: string, secrets: readonly string[]): ScratchReport;
export function leftoverProcesses(dir: string): { pid: number; line: string }[];

export const CLAUDE_ALLOWED_TOOLS: readonly string[];
/** How a bounded command ended: `exit` is null unless it exited by itself. */
export interface Completion {
  exit: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError: string | null;
}
export function runBounded(input: {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  graceMs?: number;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  log: (line: string) => void;
}): Promise<Completion>;
export function killRunning(signal?: string, waitMs?: number): Promise<void>;
export function groupLive(pgid: number | undefined): boolean;
/** `out/truth.json`, the contract between the runner and the grader (006 wave 1.5). */
export interface TruthRecord {
  vitest: Completion;
  nodeTest: Completion & { files: number };
}
export function groundTruth(input: {
  cwd: string;
  env: Record<string, string | undefined>;
  out: string;
  log: (line: string) => void;
  timeoutMs?: number;
  graceMs?: number;
  npx?: string;
}): Promise<TruthRecord>;
export function runId(now?: Date): string;
export interface CellArgs {
  dry: boolean;
  cold: boolean;
  resume: boolean;
  run: string;
  maxLoad: number;
  timeoutS: number;
  graceS: number;
  effort: string;
  commit: string;
  task: string;
  variant: string;
  harness: "claude" | "codex";
  model: string;
  rep: string;
}
export function cellArgs(
  argv: readonly string[],
  defaults?: { runId?: () => string; maxLoad?: number },
): CellArgs;
export function buildFixture(input: {
  work: string;
  variant: { instructions?: string; policy?: Record<string, unknown> };
  env: Record<string, string | undefined>;
  modules?: string | null;
}): string;
export function sessionCommand(input: {
  harness: "claude" | "codex";
  prompt: string;
  model: string;
  effort: string;
  pluginDir: string | null;
}): [string, string[]];

export interface Patch {
  files: string;
  find: string;
  replace: string;
  min?: number;
}
export function applyPatch(text: string, patch: Patch): { text: string; count: number };
export function patchPlugins(
  pluginsDir: string,
  variant: { patch?: readonly Patch[] },
): { find: string; count: number }[];

export interface Rate {
  k: number;
  n: number;
}
export type ExpectationGrade = "met" | "missed" | "n/a" | "not computable";
export interface Declaration {
  id: string;
  moment: string;
  rule: string;
}
export interface Declarations {
  tasks: Record<string, Record<string, unknown>>;
  expectations: Record<string, Declaration[]>;
}
export interface Rule {
  needs: readonly string[];
  reads: readonly string[];
  of: (cell: CellRecord) => boolean | null;
}
export interface ContextCount {
  key: string;
  label: string;
  of: (cell: CellRecord, declaredIds: readonly string[]) => boolean | null;
}
export const EXPECTATIONS: Readonly<Record<string, string>>;
export const RULES: Readonly<Record<string, Rule>>;
export const CONTEXT: readonly ContextCount[];
export function declarations(file?: string | URL): Declarations;
export function notGraded(
  cell: CellRecord,
  conditions: Pick<Conditions, "tasks"> | undefined,
  declared: Declarations,
): string | null;
export function expectationsOf(
  cell: CellRecord,
  conditions: Pick<Conditions, "tasks"> | undefined,
  declared: Declarations,
): Record<string, ExpectationGrade> | null;
export function falseClaim(cell: CellRecord, claim: "pass" | "fail"): boolean | null;
export function rate(values: readonly (boolean | null | undefined)[]): Rate | null;
export function metRate(
  grades: readonly (Record<string, ExpectationGrade> | null)[],
  id: string,
): Rate | null;
export function dropped(before: Rate | null, now: Rate | null, points?: number): boolean;

export type CellRecord = { id: string; harness: string; model: string; [key: string]: unknown };
export interface Conditions {
  fixture: string | null;
  tasks: Record<string, { prompt: string; knobs: Record<string, unknown> }>;
  variant: string;
  effort: string;
  fingerprint: string;
}
export function conditionsOf(input: {
  fixture: string | null;
  tasks: Record<string, { prompt: string; knobs?: Record<string, unknown> }>;
  variant: string;
  effort: string;
}): Conditions;
export function cellRecord(grade: Record<string, unknown>): CellRecord;
export function armFixtures(
  grades: readonly { variant: string; head: string }[],
  arms: readonly string[],
): Record<string, string | null>;
export function resultsName(input: {
  date: string;
  version: string;
  run: string;
  variant?: string | null;
}): string;

export interface ResultsFile {
  kind: "baseline" | "variant";
  date: string;
  squealVersion: string;
  commit: string;
  conditions: Conditions;
  models?: { harness: string; model: string; status: "served" | "missing"; standIn?: string }[];
  cells: CellRecord[];
  /** The expectations revision `regrade.mjs` last graded the file's cells under. */
  expectationsRevision?: string;
}
export interface Scores {
  headline: Rate | null;
  expectations: Record<string, Rate | null>;
  byTask: Record<string, Record<string, Rate | null>>;
  notComputable: number;
  context: Record<string, Rate | null>;
}
export interface TrendLine {
  fingerprint: string;
  runs: {
    name: string;
    models: string[];
    scores: Record<string, Scores>;
    flags: { model: string; expectation: string; before: Rate | null; now: Rate | null }[];
    ungraded: Record<string, { why: string; n: number }>;
  }[];
}
export function expectationsRevision(declared: Declarations): string;
export function trendLines(
  runs: readonly { name: string; data: ResultsFile }[],
  declared?: Declarations,
): TrendLine[];
export function trendMarkdown(
  runs: readonly { name: string; data: ResultsFile }[],
  declared?: Declarations,
): string;
