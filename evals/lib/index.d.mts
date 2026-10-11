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
  | {
      kind: "vitest" | "node:test";
      runner: "vitest" | "node:test";
      /** Help, version, listing or watch-only: never a run. */
      informational: boolean;
      scope: TestScope;
    }
  | { kind: "sleep"; seconds: number }
  | { kind: "write"; path: string }
) & { execution: Execution };
/** What a test command selects, as written (wave 2.6's contract). */
export type TestScope = (
  | { full: true }
  | { full: false; paths: string[]; related?: string[]; changed?: true }
) & {
  names?: string[];
  /** Review wave 2.6, B3: the filters that narrow a run, each set only when given. */
  exclude?: string[];
  projects?: string[];
  shard?: string;
  skip?: string[];
  only?: true;
};
export function scopeLabel(scope: TestScope): "full" | "files" | "name";
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
  scope: TestScope;
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
  /** The retained timeline a results cell keeps as `timeline`. */
  retained: Step[];
  /** The numbered, trimmed transcript the judge reads (spec 006 D9), before redaction. */
  transcript: string[];
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
  /** `completed-run-covers`: the runner, the tests Squeal cannot answer, the change they follow. */
  runner?: "vitest" | "node:test";
  files?: string[];
  after?: string | null;
}
export interface Declarations {
  tasks: Record<string, Record<string, unknown>>;
  expectations: Record<string, Declaration[]>;
  /** What a task records as context (T2's `redStep`). */
  context?: Record<string, { redStep?: { test: string; check?: string; fix: string } }>;
}
export interface Rule {
  needs: readonly string[];
  reads: readonly string[];
  /** Fields the declaration must carry. */
  params?: readonly string[];
  of: (cell: CellRecord, declaration?: Declaration) => boolean | null;
}
export interface ContextCount {
  key: string;
  label: string;
  of: (
    cell: CellRecord,
    declaredIds: readonly string[],
    context?: { redStep?: { test: string; check?: string; fix: string } },
  ) => boolean | null;
}

/** What a test run selects: 006-16's `TestScope`. */
export type Scope = TestScope;
/** One step of a cell's retained timeline (D4 "Retained evidence"), in the order seen. */
export type Step =
  | { k: "edit"; path: string }
  | {
      k: "run";
      runner: "vitest" | "node:test";
      informational: boolean;
      scope: Scope;
      completed: boolean;
      exit: number | null;
      /** The checks a Vitest run's output named failed (review 006-18 S1). */
      failed?: string[];
    }
  | Evidence
  | { k: "sleep"; s: number }
  | { k: "claim" };
/** The Squeal evidence one pull or delivery carried. */
export interface Evidence {
  k: "squeal";
  from: "push" | "pull";
  revision: number | null;
  pending: number | null;
  stale: number | null;
  unknown: number | null;
  /** The slow tier current; `null` where the text has no slow-tier line. */
  slow: boolean | null;
  daemon: boolean;
  /** The known-failure count a status or registration listed; `null` for a delivery. */
  known?: number | null;
  /** Each check the text named, with its own provenance (review 006-18 B2, S2). */
  checks?: CheckSeen[];
  failures: number;
  /** The failure count may be wrong: an overflow hid which checks were failing already. */
  uncertain?: true;
  verdict: "pass" | "fail" | "unknown";
  /** Test files named current at the revision, and those named failing. */
  files: string[];
  failing: string[];
}
/** One check a Squeal text named, or `count` checks a collapsed list or an overflow counts. */
export type CheckSeen =
  | {
      check: string;
      file: string;
      to: "fail" | "pass" | "resolved";
      from: string | null;
      observed: number | null;
      validity: string;
      stated?: true;
    }
  | { to: "fail" | "pass" | "resolved"; count: number };
/** Known failures: check names, and a count of those no text named. */
export interface Failing {
  named: string[];
  unnamed: number;
  uncertain?: boolean;
}
export function squealEvidence(
  text: string,
  from: "push" | "pull",
  failures?: number | Failing,
): Evidence | null;
export function failingAfter(before: Failing, step: Evidence): Failing;
export function currentCheck(step: Evidence, check: CheckSeen): boolean;
export function replayed(timeline: readonly Step[]): Step[];
export function completedRuns(out: unknown): { vitest: number; "node:test": number };
export function failedChecks(out: unknown): string[];
export function selects(path: string, file: string, runner: string): boolean;
export function selectsFile(scope: unknown, file: string, runner: string): boolean;
export function filtered(scope: TestScope): boolean;
export function vitestFiles(timeline: readonly Step[]): string[];
export function covers(scope: unknown, files: readonly string[], runner: string): boolean;
export function answeredRuns(timeline: readonly Step[]): number;
export function coveredRun(
  timeline: readonly Step[],
  d: { runner: string; files: readonly string[]; after?: string | null },
): boolean | null;
export function currentBeforeClaim(timeline: readonly Step[], claim: unknown): boolean | null;
export function claimedOnEvidence(
  timeline: readonly Step[],
  claim: unknown,
): boolean | null | "not computable";
export function redStep(
  timeline: readonly Step[],
  d: { test: string; check?: string; fix: string },
): { squeal: boolean; ownRun: boolean };
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
/** The frozen parser's grade; for the four the judge grades, the cross-check (D4, D9). */
export function parserExpectationsOf(
  cell: CellRecord,
  conditions: Pick<Conditions, "tasks"> | undefined,
  declared: Declarations,
): Record<string, ExpectationGrade> | null;
export function parserOf(
  cell: CellRecord,
  conditions: Pick<Conditions, "tasks"> | undefined,
  declared: Declarations,
): Record<string, ExpectationGrade> | null;
export interface Disagreement {
  id: string;
  judge: ExpectationGrade;
  parser: ExpectationGrade;
  reason: string;
  steps: unknown;
}
export function disagreements(
  cell: CellRecord,
  conditions: Pick<Conditions, "tasks"> | undefined,
  declared: Declarations,
): Disagreement[];

// ---------- the judge (spec 006 D9) ----------
export type JudgeVerdict = "met" | "missed" | "n/a" | "cannot tell";
export interface JudgeIdentity {
  model: string;
  effort: string;
  claudeCode: string;
  rubric: string;
}
export interface JudgedVerdict {
  verdict: JudgeVerdict | null;
  steps: unknown;
  reason: string;
  grade: ExpectationGrade;
}
export interface CellJudge {
  identity: JudgeIdentity;
  transcriptHash: string;
  verdicts: Record<string, JudgedVerdict>;
  cost: number | null;
  served?: string[];
  /** The expectations whose verdict did not arrive evidence first and verdict last (006-30). */
  unordered?: string[];
  error?: string;
  cached?: boolean;
}
export interface RunnerResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type JudgeRunner = (call: { args: string[]; input?: string }) => Promise<RunnerResult>;
export const JUDGED: readonly string[];
export const JUDGE: { model: string; effort: string };
export const SYSTEM: string;
export const RUBRIC: Readonly<Record<string, string>>;
export function rubricOf(task: string, declared: Declarations): string;
export function trimOutput(out: string | undefined, whole: boolean): string;
export function transcriptOf(timeline: Timeline): string[];
export function judgeInput(input: {
  task: string;
  situation: string;
  claim: string | null;
  transcript: readonly string[];
}): string;
export function situationOf(knobs?: Record<string, unknown>): string;
export function schemaOf(ids: readonly string[]): Record<string, unknown>;
export function unorderedOf(out: unknown, ids: readonly string[]): string[];
export function judgeArgs(input: {
  model: string;
  effort: string;
  system: string;
  schema: Record<string, unknown>;
}): string[];
export function judgeEnv(
  parent: Record<string, string | undefined>,
  scratch: string,
): Record<string, string>;
export function claudeRunner(options?: {
  base?: string;
  parent?: Record<string, string | undefined>;
  command?: string;
  prefix?: string[];
  timeoutMs?: number;
}): JudgeRunner;
export function claudeVersion(runner: JudgeRunner): Promise<string>;
export function rubricRevision(declared: Declarations): string;
export function judgeIdentity(input: {
  model: string;
  effort: string;
  claudeCode: string;
  declared: Declarations;
}): JudgeIdentity;
export function identityKey(identity: JudgeIdentity): string;
export function gradeOf(verdict: unknown, steps: number): ExpectationGrade;
export function transcriptHash(task: string, transcript: readonly string[]): string;
export const JUDGE_MODELS: readonly string[];
export function calibrationName(identity: JudgeIdentity): string;
export function declaredConditions(declared: Declarations): Pick<Conditions, "tasks">;
export interface CalibrationReference {
  name: string;
  task: string;
  harness: string;
  cell: CellRecord;
  expected: Record<string, string>;
}
export interface Calibration {
  kind: "judge-calibration";
  identity: JudgeIdentity;
  rounds: number;
  passed: boolean;
  sessions: number;
  failed: string[];
  /** Calls with a verdict that did not arrive last (006-30); absent in files from before it. */
  unordered?: number;
  costUsd: number;
  references: {
    name: string;
    task: string;
    harness: string;
    /** The reference's `transcriptHash` (006-30); absent in files from before it. */
    transcriptHash?: string;
    expected: Record<string, string>;
    parser: Record<string, ExpectationGrade> | null;
    pass: boolean;
    runs: {
      grades: Record<string, ExpectationGrade>;
      verdicts: Record<string, Omit<JudgedVerdict, "grade">>;
      cost: number | null;
      unordered?: string[];
      error?: string;
    }[];
  }[];
}
export function calibrate(input: {
  references: readonly CalibrationReference[];
  declared: Declarations;
  identity: JudgeIdentity;
  runner: JudgeRunner;
  rounds?: number;
  parallel?: number;
}): Promise<Calibration>;
/** How `calibration` differs from `references` by name, transcript hash and expected grades. */
export function coverageGaps(
  calibration: Pick<Calibration, "references">,
  references: readonly CalibrationReference[],
): string[];
export function calibratedIdentity(input: {
  dir: string;
  declared: Declarations;
  runner: JudgeRunner;
}): Promise<JudgeIdentity | null>;
export function ensureCalibrated(input: {
  dir: string;
  declared: Declarations;
  runner: JudgeRunner;
  calibrateModel: (model: string) => Promise<unknown>;
  log?: (line: string) => void;
}): Promise<JudgeIdentity | null>;
export function judgeRecord(
  cell: CellRecord,
  options: {
    identity: JudgeIdentity;
    runner: JudgeRunner;
    declared: Declarations;
    conditions: Pick<Conditions, "tasks"> | undefined;
  },
): Promise<{ judge: CellJudge; parser: Record<string, ExpectationGrade> | null }>;
export function judgeCell(input: {
  task: string;
  transcript: readonly string[];
  claim: string | null;
  declared: Declarations;
  identity: JudgeIdentity;
  runner: JudgeRunner;
  cache?: CellJudge | null | undefined;
}): Promise<CellJudge>;
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
