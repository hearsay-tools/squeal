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
  | {
      kind: "squeal";
      /** The CLI as the command names it: `squeal`, a path, or `npx squeal` (review 006-63 B2). */
      bin: string;
      sub: string;
      wait: boolean;
      all: boolean;
      slow: boolean;
      /** `retry` only (row 006-53): the paths as written, `--reason`, `--cancel`. */
      paths?: string[];
      reason?: string | null;
      cancel?: boolean;
    }
  /** A start of the retry scenarios' rates service (row 006-53). */
  | { kind: "service" }
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
/** Command output for the judge (D9): Squeal's whole, the rest trimmed around its summary lines. */
export function trimOutput(out: string | undefined, whole: boolean): string;
/** The judge's numbered, trimmed transcript (D9); step `n` is index `n - 1`. */
export function transcriptOf(timeline: Timeline): string[];

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
  cmd: string;
}
export interface Grade {
  reachedModel: boolean;
  edits: number;
  forbiddenEdit: boolean;
  vitestRuns: number;
  vitestByScope: { full: number; files: number; name: number };
  nodeTestRuns: number;
  refused: number;
  failedEdits: number;
  indeterminate: number;
  testAttemptsRefused: number;
  squealPulls: number;
  squealWaits: number;
  squealWhy: number;
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
    /** Each Squeal command Squeal answered (row 006-62, review 006-63 B2). */
    pulls: { n: number; sub: string; wait: boolean; all: boolean; slow: boolean }[];
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
  /** The rates service's record of the session's starts (`serviceStartsOf`, 006-69), or `null`. */
  serviceStarts?: readonly ServiceStart[] | null;
}): Grade;
/** A start the rates service recorded: when, in ms since the session's start, and what it said. */
export interface ServiceStart {
  t: number;
  reply: "listening" | "running" | "failed";
}
export function serviceStartsOf(text: string, t0: number): ServiceStart[];
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
export function squealBin(harness: "claude" | "codex", cell: string, pin: string): string;
export function pathFirst(path: string | undefined, dir: string): string;
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
  /** Written to the command's stdin, otherwise closed (006-98). */
  input?: string;
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
  /** Claude Code's turn 1 of a multi-turn session names this session id (006-33). */
  sessionId?: string | null;
  /** A later turn resumes this session: Claude Code's session id or Codex's thread. */
  resume?: string | null;
  /** Claude Code rules after `CLAUDE_ALLOWED_TOOLS`, from the cell's knobs (006-66). */
  tools?: readonly string[];
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
  /** A `squeal retry` call (row 006-53): the test files Squeal's reply says it queued. */
  | { k: "retry"; paths: string[]; reason: string | null; cancel: boolean; queued: string[] }
  /**
   * An executed `squeal run`, whatever it printed (re-review 006-59 R1); `answered` when Squeal
   * answered it (001-428; absent in records graded before).
   */
  | { k: "squeal-run"; all: boolean; slow: boolean; answered?: boolean }
  /** A start of the rates service (row 006-53); `started` when it said it listens. */
  | { k: "service"; started: boolean }
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
  /** The slow files its `Slow tier:` line states are not current; absent without one (006-91). */
  slowNotCurrent?: number;
  daemon: boolean;
  /** The known-failure count a status or registration listed; `null` for a delivery. */
  known?: number | null;
  /** Each check the text named, with its own provenance (review 006-18 B2, S2). */
  checks?: CheckSeen[];
  failures: number;
  /** The failure count may be wrong: an overflow hid which checks were failing already. */
  uncertain?: true;
  verdict: "pass" | "fail" | "unknown";
  /** A pull's subcommand, `status` or `run` (review 006-57 B1). */
  sub?: string;
  /** The test files a status lists under `Pending retries:` (row 006-53), or names in its `Outstanding:` retry groups (row 011-29). */
  pendingRetries?: string[];
  /** The test files a named-files wait selected, each with a current result (row 006-55). */
  selected?: string[];
  /** Test files named current at the revision, and those named failing. */
  files: string[];
  failing: string[];
}
/**
 * One check a Squeal text named, or `count` checks a collapsed list or an overflow counts, or a
 * group of failures with one error and location counts in one test file (`file`) or past its
 * tenth test file (row 011-109), with the group's provenance.
 */
export type CheckSeen =
  | {
      check: string;
      file: string;
      to: "fail" | "pass" | "resolved";
      from: string | null;
      observed: number | null;
      validity: string;
      stated?: true;
      /** On a pass a retry's own run stored: the reason it was asked for (row 006-53). */
      retried?: string;
    }
  | { to: "fail" | "pass" | "resolved"; count: number }
  | {
      to: "fail";
      count: number;
      file?: string;
      from: string | null;
      observed: number | null;
      validity: string;
    };
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
/** The text a Claude Code hook's JSON reply delivers to the model; any other text as it is. */
export function hookText(text: string): string;
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
export function slowThroughSqueal(
  timeline: readonly Step[],
  requested: boolean,
  files: readonly string[],
): boolean;
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
  graceMs?: number;
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

export type CellRecord = { id: string; harness: string; model: string; [key: string]: unknown };
export interface Conditions {
  fixture: string | null;
  tasks: Record<string, { prompt: string; knobs: Record<string, unknown> }>;
  variant: string;
  effort: string;
  tools?: Record<string, readonly string[]>;
  fingerprint: string;
}
export function conditionsOf(input: {
  fixture: string | null;
  tasks: Record<string, { prompt: string; knobs?: Record<string, unknown> }>;
  variant: string;
  effort: string;
  tools?: Record<string, readonly string[]>;
}): Conditions;
/** `config` narrowed to the named models and tasks; throws on a name it does not hold (006-45). */
export function narrowed<C extends { models: { model: string }[]; tasks: string[] }>(
  config: C,
  only?: { models?: readonly string[] | null; tasks?: readonly string[] | null },
): C;
export function cellRecord(grade: Record<string, unknown>): CellRecord;
export function armFixtures(
  grades: readonly { variant: string; head: string }[],
  arms: readonly string[],
): Record<string, string | null>;
/** A results file's `regraded` note, as a regrade stamps it (006-86). */
export interface RegradedNote {
  by: string;
  date: string;
  changed: string[];
  /** The expectations pass's notes name the revision that graded them. */
  revision?: string;
  /** `regrade-cells.mjs`: the cells whose stored evidence alone changed. */
  evidence?: string[];
  [field: string]: unknown;
}
/** `regraded` with `note` added, replacing an earlier note by the same row and revision. */
export function stamped(
  regraded: readonly RegradedNote[] | undefined,
  note: RegradedNote,
): RegradedNote[];
export function resultsName(input: {
  date: string;
  version: string;
  run: string;
  variant?: string | null;
  /** An atomic run: `.atomic`, or `.<variant>.atomic-variant` with a variant (006-48). */
  atomic?: boolean;
}): string;

export interface ResultsFile {
  kind: "baseline" | "variant" | "atomic" | "atomic-variant";
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
/** Writes `dir`/TREND.md from every results file there; returns how many baseline runs it read. */
export function writeTrendMarkdown(dir: string, declared?: Declarations): number;

// 006-33: atomic scenarios (evals/atomic/) and a session's later turns.
export const ATOMIC: string;
export interface AtomicReference {
  path: string;
  find: string;
  replace: string;
}
export interface AtomicDeclaration {
  turns: string[];
  knobs?: Record<string, unknown>;
  reference: AtomicReference;
  /** Test files the reference edit leaves failing. */
  breaks: string[];
  /** The scored ones of MEASURES. */
  measures?: string[];
  /** `false`: a later turn is sent at once, not once Squeal settles (D10 a4-pending). */
  waitSettled?: boolean;
  /** What `own-run-covers` reads: D4's completed-run-covers parameters. */
  ownRun?: { runner: "vitest" | "node:test"; files: string[]; after: string | null };
  /** What the retry measures read (row 006-53). */
  failure?: RetryFailure;
}
/** The test file whose FAIL a retry scenario is about, the paths past it, and its cause. */
export interface RetryFailure {
  file: string;
  inputs: string[];
  cause: "service" | null;
}
export function retryForEnvironment(timeline: readonly Step[], failure: RetryFailure): boolean;
/** `false` where a9's asked edit healed the failure after the service start, before a retry. */
export function retryArose(timeline: readonly Step[], failure: RetryFailure): boolean;
export function noRetryPastFailure(timeline: readonly Step[], failure: RetryFailure): boolean;
export function claimAfterRetry(
  timeline: readonly Step[],
  claim: string | null | undefined,
  failure: RetryFailure,
): boolean | null;
/** The knobs' fixture files (evals/atomic/retry/), at their paths in the fixture. */
export const SERVICE_FILES: readonly string[];
export function knobTools(knobs: Record<string, unknown>): string[];
/**
 * a11's `inherited` staging; throws unless the FAIL stands at the knob's load (006-57 S1). The
 * load drops only after a wait on the file returned, and the daemon is kept (006-62).
 */
export function stageInherited(
  knobs: Record<string, unknown>,
  deps: {
    squeal: (
      args: string[],
      opts?: { env?: Record<string, string> },
    ) => {
      status: number | null;
      stdout: string;
      stderr: string;
    };
    /** Not called since 006-62: the warm-up's daemon is kept, with the calendar's cache. */
    stop?: (why: string) => Promise<void>;
    setLoad: ((perCpu: number) => void) | null;
    log: (s: string) => void;
    recordedLoads: (file: string) => Promise<number[]>;
  },
): Promise<string>;
export function retryEnv(
  knobs: Record<string, unknown>,
  cell: string,
  env: Record<string, string | undefined>,
): ((perCpu: number) => void) | null;
export interface AtomicConfig {
  description: string;
  models: { harness: "claude" | "codex"; model: string }[];
  repetitions: number;
  effort: string;
  parallel: number;
  variant: string;
  settleS: number;
  scenarios: Record<string, AtomicDeclaration>;
}
export interface Scenario extends AtomicDeclaration {
  name: string;
  /** One per turn; the last ends with the claim line's request. */
  prompts: string[];
  knobs: Record<string, unknown>;
  /** The config's bound on the wait before a later turn, in seconds. */
  settleS: number;
}
export function atomicConfig(file?: string): AtomicConfig;
export function scenarioOf(name: string, config?: AtomicConfig): Scenario | null;
export function applyReference(dir: string, scenario: Scenario): void;
export interface Settled {
  settled: boolean;
  /** True too when waiting cannot help: no daemon validating. */
  done: boolean;
  why: string;
  /** Checks or test files still to run, the slow tier's included. */
  pending?: boolean;
  /** The slow tier waits for its load gate: not started (D10). */
  deferred?: boolean;
}
export function settledOf(status: string | Json): Settled;
export interface SettleRecord {
  settled: boolean;
  why: string;
  waitedMs: number;
  polls: number;
  /** The last `squeal status --json` read. */
  status: string;
  /** Whether checks were still pending at the last read. */
  pending?: boolean;
}
/** Squeal's default `slow.maxDeferMs`. */
export const MAX_DEFER_MS: number;
export function maxDeferMsOf(dir: string): number;
export function settleSnapshot(status: () => string): SettleRecord;
export function waitSettled(input: {
  status: () => string;
  timeoutMs: number;
  /** The bound while the slow tier is load-deferred, with the tier's last duration. */
  maxDeferMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SettleRecord>;
export function readEvents(out: string): Event[];
export interface Turns {
  exits: Completion[];
  /** Each later turn's start, in ms since turn 1 started. */
  turnStarts: number[];
  settle: SettleRecord | null;
  t0: number;
  t1: number;
  samples: number[];
  command: string;
}
export function runTurns(input: {
  prompts: readonly string[];
  harness: "claude" | "codex";
  command: (turn: {
    prompt: string;
    sessionId: string | null;
    resume: string | null;
  }) => [string, string[]];
  session: (
    command: string,
    args: string[],
    t0: number | null,
  ) => Promise<{ exit: Completion; t0: number; t1: number; samples: number[] }>;
  settle: () => SettleRecord | Promise<SettleRecord>;
  out: string;
  log: (line: string) => void;
  load: () => string;
}): Promise<Turns>;
export function codexThread(events: readonly Event[]): string | null;
export function usageOf(events: readonly Event[]): {
  costUsd: number | null;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
};
export interface PilotRecord {
  turns: number;
  turnStarts: number[];
  settle: {
    settled: boolean;
    why: string;
    waitedMs: number;
    pending?: boolean | null;
  } | null;
  truthPass: boolean | null;
  claim: "pass" | "fail" | "unknown" | null;
  claimTrue: boolean | "hedged" | null;
  falsePass: boolean | null;
  squealVerdict: string | null;
  ownRuns: number;
  /** Slow-tier commands after the last edit, before the claim, in order. */
  slowBeforeClaim: { n: number; what: string }[];
  squealWaitsAfterLastEdit: number | null;
  sleeps: number | null;
  /** The declared measures: met, missed, or `null` not computable. */
  measures: Record<string, boolean | null>;
}
export interface MeasureContext {
  /** The cell's retained timeline; `null` or absent when it kept none. */
  timeline?: Step[] | null;
  scenario?: Partial<AtomicDeclaration>;
  /** Whether the cell's repository had `stop.requireSlowSuite` on (D10 as amended, 006-91). */
  slowRequired?: boolean;
  /** The cell's `TESTS:` line, whose evidence may state the slow files not current. */
  claimLine?: string | null;
}
/** The fixture's slow test file's checks: its one test and its load check (006-91). */
export const SLOW_CHECKS: number;
/**
 * Whether a cell of `variant` ran with `stop.requireSlowSuite` on (fixture and variant policy),
 * or with the knob `requireSlowSuite` among the `knobs` its run recorded (006-94).
 */
export function slowRequiredOf(
  variant: string | null | undefined,
  knobs?: Record<string, unknown> | null,
): boolean;
/** The slow files a claim's evidence states were not current; `null` when it states none. */
export function statedSlowCount(evidence: string | null | undefined): number | null;
/** D10 as amended: whether an `unknown` stating `stated` slow files not current is right. */
export function honestUnknown(
  timeline: Step[],
  stated: number | null,
  options: { checksPerFile: number },
): boolean | null;
/** The slow files a `Slow tier:` line (the text after its label) states are not current. */
export function slowNotCurrentOf(tier: string): number;
export const MEASURES: Record<
  string,
  (record: PilotRecord, context?: MeasureContext) => boolean | null
>;
export function measuresOf(
  record: PilotRecord,
  context: {
    timeline: Step[] | null | undefined;
    scenario: Partial<AtomicDeclaration>;
    slowRequired?: boolean;
    claimLine?: string | null;
  },
): Record<string, boolean | null>;
export function pilotRecord(
  grade: Record<string, unknown>,
  input: {
    turns?: number;
    turnStarts?: number[];
    settle?: {
      settled: boolean;
      why: string;
      waitedMs: number;
      pending?: boolean | null;
    } | null;
    scenario?: Partial<AtomicDeclaration> | null;
    declared?: readonly string[];
    /** The cell's slow policy; from its grade's `variant` when not given. */
    slowRequired?: boolean;
  },
): PilotRecord;
/** The row regrading and its note, stamped on a file only where a cell changed (006-80). */
export interface RegradeStamp {
  by: string;
  note: string;
}
export function regradeAtomic(
  data: Json,
  config: AtomicConfig,
  date: string,
  stamp: RegradeStamp,
): { data: Json; changed: string[] };

// 006-82: committed cells graded again from their kept raw `out/`.
/** evals/bin/grade.mjs's grade of a cell's `out/`, unwritten; `null` without `meta.json`. */
export function gradeOut(out: string): Record<string, unknown> | null;
/** The `cellRecord` fields `gradeCell` sets, refreshed from `out/`. */
export const MECHANICAL: readonly string[];
export interface RegradeContext {
  conditions: Json | undefined;
  declared: Declarations;
  config: AtomicConfig;
}
export function regradedCell(
  cell: Record<string, unknown>,
  grade: Record<string, unknown>,
  context: RegradeContext,
): Record<string, unknown>;
export interface CellChanges {
  /** Each changed grade: `[name, before, after]`, as `parser no-overclaim`. */
  grades: [string, unknown, unknown][];
  /** The other changed fields' names. */
  evidence: string[];
}
export function changesOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): CellChanges;
export function regradeFromOut(
  data: Json,
  input: RegradeStamp & {
    gradeOf: (cell: Record<string, unknown>) => Record<string, unknown> | null;
    declared: Declarations;
    config: AtomicConfig;
    date: string;
  },
): {
  data: Json;
  changed: string[];
  evidence: string[];
  missing: string[];
  diffs: (CellChanges & { id: string })[];
};
export function runDirOf(root: string, run: string): string | null;

// 006-36: evals/results/ATOMIC.md, the atomic tier's per-model counts, flags and alarms.
export const FLAG_P: number;
/** The adoption scoreboard's 90% target. */
export const RELIABLE: number;
export const WINDOW: number;
/** Claude cells of runs whose id sorts before this ran under the old root (D10, 006-47). */
export const OLD_ROOT_BEFORE: string;
export function oldRoot(runId: string, harness: string): boolean;
/** From this run id, Claude cells met the host's terminal launcher until they record `squealPath` (006-62). */
export const HOST_LAUNCHER_FROM: string;
export function hostLauncher(
  runId: string,
  cells: readonly { harness?: string; squealPath?: string }[],
): boolean;
export type BrokenCondition = "old root" | "host launcher";
export function brokenCondition(
  runId: string,
  cells: readonly { harness?: string; squealPath?: string }[],
): BrokenCondition | null;
/** One-sided Fisher exact p that `now` is lower than `before`. */
export function fisherLower(before: Rate, now: Rate): number;
/** `ln C(n, k)`. */
export function lnChoose(n: number, k: number): number;
/** The 95% Wilson range of a count, `[low, high]` as fractions. */
export function wilson(rate: Rate): [number, number];
/** Two-sided Fisher exact p of one count against another. */
export function fisherTwoSided(a: Rate, b: Rate): number;
export function atomicDropped(before: Rate | null, now: Rate | null): boolean;
export function scenarioRevision(data: Json, scenario: string): string;
export function compareVersions(a: string, b: string): number;
export function countText(rate: Rate | null): string;
export interface AtomicRun {
  name: string;
  /** The results file's run id. */
  run: string;
  version: string;
  /** Claude cells of a run before OLD_ROOT_BEFORE: shown, counted by no flag or scoreboard. */
  oldRoot: boolean;
  /** The broken condition its cells ran under (old root, or the host's launcher, 006-62), counted by no flag or scoreboard. */
  broken: BrokenCondition | null;
  sessions: number;
  /** Each measure's values in rep order: met, missed or `null` not computable. */
  values: Record<string, (boolean | null)[]>;
  measures: Record<string, Rate | null>;
  /** The release this run was compared against, when one came before it. */
  previous?: string;
  flags: { measure: string; before: Rate; now: Rate; p: number }[];
}
export interface AtomicTrend {
  runs: { name: string; data: Json }[];
  groups: { model: string; scenario: string; revision: string; runs: AtomicRun[] }[];
  alarms: { run: string; cell: string; what: "false pass" | "forbidden edit"; line?: string }[];
  /** The adoption scoreboard: each measure over the model's last WINDOW sessions, against 90%. */
  scoreboard: {
    model: string;
    scenario: string;
    revision: string;
    measure: string;
    rate: Rate;
    meets: boolean;
  }[];
}
export function atomicTrend(runs: readonly { name: string; data: Json }[]): AtomicTrend;
export function atomicMarkdown(runs: readonly { name: string; data: Json }[]): string;

// 006-48: an atomic variant run's two arms, per model, scenario and measure.
export interface AtomicCompareRow {
  /** `<harness> <model>`. */
  model: string;
  scenario: string;
  measure: string;
  /** Each arm's count, the shipped arm first; `null` when no session was computable. */
  counts: [Rate | null, Rate | null];
  /** Two-sided Fisher p; `null` unless both arms have a count. */
  p: number | null;
}
export function atomicCompare(data: Json): { arms: [string, string]; rows: AtomicCompareRow[] };
export function atomicCompareMarkdown(data: Json, name: string): string;
