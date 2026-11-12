import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, POLICY_FILE } from "../../daemon/policy.js";
import { compare } from "../../fs/compare.js";
import { findWorktreeRoot } from "../../fs/git-layout.js";
import { readObjectFormat } from "../../hash/git-index.js";
import { createDeclaredInputs } from "../../keys/closure.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { PolicyInputs } from "../../types/policy.js";
import type { RunnerClosure, RunnerEnvironment, RunReport } from "../../types/runner.js";
import type { BlobCache } from "../coverage/record.js";
import { coverageProvider, PROVIDER_MISSING_NOTE } from "../coverage/runtime.js";
import type { RunEstimate } from "./estimate.js";
import { keptLogs, leftOutFiles, type RunLog } from "./evidence.js";
import { runLanes, SlotPool } from "./lanes.js";
import { inLoaderOrder, orderRuns } from "./plan.js";
import type { BasePrepares } from "./prepare.js";
import { type Picked, type SelectionSummary, tellSelection } from "./prerun.js";
import { FileProgress, type Overrun } from "./progress.js";
import type { Mapped } from "./records.js";
import { type GateAdapters, openRunners, type Runner } from "./runners.js";
import { type GateScope, type LeftOutFile, type ScopeTally, tallyScope } from "./scope.js";
import { type IncompleteClosure, tellClosures } from "./select-closures.js";
import { storedOf, tellEstimates } from "./steps.js";
import { type ChangedSet, type Evidence, GATE_RUNNERS, type TestFileEvidence } from "./types.js";

/*
 * Spec 020 D3 (row 020-03): the one-shot collector. It opens the project's
 * own Vitest and node:test adapters with Squeal's coverage provider, as the
 * daemon builds them (015 D8), with no daemon and no store; selects the
 * test files that load a changed path, every changed test file, the
 * `--test` files and the test files whose declared `inputs` at the base
 * name a changed path (row 020-35); runs them under one deadline; and
 * maps each completed file's payload to its record before the adapter
 * closes, which deletes it.
 * D12 (row 020-10b): with `coverage.children` at the base, the runners
 * collect the coverage of the processes and threads the tests start too.
 */

export interface CollectOptions {
  /** `--test` files, relative to the worktree root (D3.1). */
  readonly tests: readonly RelativePath[];
  /**
   * D3.1 (row 020-35): the top-level `inputs` at the base. A test file
   * whose declared inputs, by the daemon's rules, name a changed path is
   * selected. Absent, none is declared.
   */
  readonly inputs?: PolicyInputs;
  /** The one deadline over every run, from the call (D3.4). */
  readonly budgetSeconds: number;
  readonly adapters: GateAdapters;
  /** The adapters' notes, such as a file run with coverage off; dropped when absent. */
  readonly note?: (text: string) => void;
  /** D11.7, D13.2: the evidence known of a runner's selected files without a run; those do not run. */
  readonly stored?: StoredEvidence;
  /**
   * D12.1: `coverage.children` read at the base: the runs collect the
   * coverage of the processes and threads the tests start. Absent, off.
   */
  readonly children?: boolean;
  /**
   * D14: the scope at the base with `--group`: a selected file of a group
   * outside it does not run, and its closure is read. Absent, every
   * selected file runs, as before.
   */
  readonly scope?: GateScope;
  /** D15.2: the base's `prepare` of each node:test entry, by name; absent, the base declares none. */
  readonly prepares?: BasePrepares;
  /** D15.3: a `prepare` command's output, as it comes, for stderr; dropped when absent. */
  readonly output?: (text: string) => void;
  /**
   * D14.4: told the selection once, after it and before the first run, so
   * before any setup runs. Not called when no runner opens.
   */
  readonly selected?: (summary: SelectionSummary) => void;
  /** D6: `coverage.exclude` at the base; `selected` looks for no loader of a path it matches. */
  readonly excluded?: (path: RelativePath) => boolean;
  /**
   * D17: a selected file's stored seconds, the whole file as a daemon last
   * ran it; `null` when the stores hold none. Absent: there is no store, so
   * the estimate is unknown and the order counts loaders.
   */
  readonly durations?: (ref: TestFileRef) => number | null;
  /**
   * D17.1: told each runner's estimate once, after the stored lookup and
   * the selection (D14.4) and before the first run or `prepare`, with the
   * whole seconds left of the budget. Not called when no file is to run.
   */
  readonly estimated?: (estimates: readonly RunEstimate[], leftSeconds: number) => void;
  /**
   * D17.3: told each runner's run once it ended, while the other runners'
   * runs may still run (D18 as amended); with it, Vitest records runtime
   * reads as the worktree's daemon does.
   */
  readonly ran?: (run: GateRun) => Promise<void>;
  /**
   * #197 (row 020-40): keeps the log folders of a runner kind's runs with a failed or unfinished
   * file as one, after the runs and before the temporary folder goes; gives where, `null` when it
   * kept none. Absent, no log is kept.
   */
  readonly keepLog?: (run: RunLog) => Promise<AbsolutePath | null>;
  /**
   * Row 020-43 (#196): told each file that runs past its estimate, once,
   * while it still runs (`FileProgress`). Absent, none is told.
   */
  readonly overran?: (file: Overrun) => void;
}

/** D17.3: one runner's run, its report and each completed file's mapped record, by `testFileId`. */
export interface GateRun {
  readonly runner: TestFileEvidence["runner"];
  readonly files: readonly TestFileRef[];
  readonly report: RunReport;
  readonly records: ReadonlyMap<string, Mapped>;
}

/**
 * The evidence of each of `files` known without a run, from the stores
 * (D11.7) or `ci record`'s parts (D13.2), by the ref given; a file it
 * leaves out runs. Called once per runner with a selected file, within the
 * budget, before the selection is told (D14.4) and before any run. `closure`, which the collector always gives,
 * is the runner's closure of a file here, `null` when it cannot give one.
 * `environment`, which it always gives too, is the runner's environment of
 * each project here, as the runs would have it; it rejects when the runner
 * cannot give one.
 */
export type StoredEvidence = (
  runner: TestFileEvidence["runner"],
  files: readonly TestFileRef[],
  closure?: (ref: TestFileRef) => Promise<RunnerClosure | null>,
  environment?: () => Promise<readonly RunnerEnvironment[]>,
) => Promise<ReadonlyMap<TestFileRef, TestFileEvidence>>;

/** D3.1: a `--test` path that no runner lists as a test file; a usage error (D1, exit 2). */
export class CollectUsageError extends Error {
  override readonly name = "CollectUsageError";
}

/**
 * The evidence of `changed`'s functions: per selected test file, whether it
 * completed before the deadline, its failed tests, the sources its closure
 * loads and its record. The test files are selected from `changed.paths`,
 * every changed path, not from the changed functions (D3.1). The budget
 * counts from the call, the adapters' start included. Once every
 * node:test entry's `prepare` ran, every runner's run starts at once, each
 * given what is left of it, and the node:test entries share
 * `runner.tierSize` processes (D18 as amended, row 020-44); a run started
 * after the deadline runs nothing. A project's own `testTimeout` is never lowered. With no changed
 * path and no `--test` file, no adapter starts.
 * A selected file `options.stored` gives evidence of does not run (D11.7).
 * Rejects when Vitest is configured but cannot start, or when Squeal's
 * provider is missing: a setup error (D1).
 */
export async function collectEvidence(
  cwd: AbsolutePath,
  changed: ChangedSet,
  options: CollectOptions,
): Promise<Evidence> {
  const { budgetSeconds } = options;
  const start = performance.now();
  const deadline = start + budgetSeconds * 1000;
  const { paths } = changed;
  const tally = options.scope === undefined ? null : tallyScope(options.scope);
  const scoped = (files: readonly LeftOutFile[]) =>
    tally === null ? {} : { scope: tally.evidence(files) };
  if (paths.length === 0 && options.tests.length === 0) {
    return { testFiles: [], timedOut: false, budgetSeconds: options.budgetSeconds, ...scoped([]) };
  }
  const root = findWorktreeRoot(cwd);
  if (root === null) throw new Error(`${cwd} is not inside a git worktree`);
  const provider = coverageProvider();
  if (provider === null) throw new Error(PROVIDER_MISSING_NOTE);
  const note = options.note ?? (() => {});
  const children = options.children === true;
  const format = await readObjectFormat(root);
  const temp = mkdtempSync(join(tmpdir(), "squeal-gate-"));
  const runners: Runner[] = [];
  try {
    const { policy, problems } = loadPolicy(root);
    for (const problem of problems) note(`${POLICY_FILE}: ${problem}`);
    const lists = new Map<string, readonly IncompleteClosure[]>();
    const closures = (project: string, files: readonly IncompleteClosure[]) =>
      lists.set(project, files);
    const keeping = options.ran !== undefined;
    // Row 020-43: the runners tell each file's start, and the files past their estimate are named.
    const { durations, overran } = options;
    const progress = new FileProgress({ budgetSeconds, since: start, durations, overran });
    // D18 as amended (row 020-44): the node:test entries' processes, `runner.tierSize` at once.
    const slots = new SlotPool(policy.runner.tierSize).take;
    const started = progress.started.bind(progress);
    const opening = { provider, temp, note, children, keeping, closures, slots, started };
    await openRunners(options.adapters, root, policy, opening, runners);
    const picked = await select(runners, { paths, ...options }, tally);
    // Review 0.1.432 B2: the stores and the parts first, so the print names only what runs.
    const known = await storedOf(picked, options);
    // D18: the runners in the order they start, which the print follows (D18.4); no closure read.
    const order = orderRuns(picked, known, { durations, tierSize: policy.runner.tierSize });
    const inOrder = order.runs.map((run) => run.pick);
    await tellSelection(options.selected, inOrder, changed, { ...options, tally, known });
    // #193: each project's files with an incomplete closure, once, scoped to this selection.
    const gaps = tellClosures(lists, picked, note);
    const runs = await inLoaderOrder(order.runs, { changed: paths, durations });
    const estimates = tellEstimates(options.estimated, order.estimates, deadline);
    const blobs: BlobCache = new Map();
    const mapping = { format, blobs, provider, children, note };
    const context = { root, deadline, note, options, children, temp, known, mapping, progress };
    // D18 as amended (row 020-44): every runner at once, the node:test entries from one pool.
    const lanes = await runLanes(runs, context).finally(() => progress.close());
    const { testFiles, prepares, timedOut } = lanes;
    const logs = await keptLogs(options.keepLog, lanes.ended);
    return {
      testFiles: [...testFiles].sort(byRunnerAndPath),
      timedOut,
      budgetSeconds: options.budgetSeconds,
      ...scoped(await leftOutFiles(picked)),
      ...(prepares.length === 0 ? {} : { prepares }),
      ...estimates,
      ...gaps,
      ...(logs.length === 0 ? {} : { logs }),
    };
  } finally {
    await Promise.allSettled(runners.map((r) => r.adapter.close()));
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * D3.1, per runner: the test files `affected()` gives for the changed
 * paths, its test files among them, the `--test` files it lists, and the
 * test files whose declared `inputs` name a changed path, which the pick's
 * `byInputs` holds when nothing else chose them (row 020-35). Throws
 * `CollectUsageError` for a `--test` file no runner lists. D14.2: with a
 * scope's `tally`, the files it leaves out are the pick's `leftOut`
 * instead of its `run`.
 */
async function select(
  runners: readonly Runner[],
  {
    paths,
    tests,
    inputs,
  }: {
    readonly paths: readonly RelativePath[];
    readonly tests: readonly RelativePath[];
    readonly inputs?: PolicyInputs | undefined;
  },
  tally: ScopeTally | null,
): Promise<(Picked & { readonly runner: Runner })[]> {
  // The daemon's rule (spec 001 D3): a list declares for every test file, a map per test glob.
  const declared =
    inputs === undefined || paths.length === 0 ? null : createDeclaredInputs(inputs, paths);
  const named = new Set([...paths, ...tests]);
  const matched = new Set<RelativePath>();
  const picked: (Picked & { readonly runner: Runner })[] = [];
  for (const runner of runners) {
    const { kind, adapter } = runner;
    const chosen = new Map<string, TestFileRef>();
    const add = (ref: TestFileRef) => chosen.set(testFileId(ref), ref);
    const listed = await adapter.testFiles();
    for (const ref of listed) {
      if (named.has(ref.path)) add(ref);
      matched.add(ref.path);
    }
    if (paths.length > 0) {
      const affected = await adapter.affected(paths);
      for (const ref of [...affected.direct, ...affected.transitive]) add(ref);
    }
    const byInputs = listed.filter(
      (ref) => !chosen.has(testFileId(ref)) && (declared?.for(ref.path).length ?? 0) > 0,
    );
    for (const ref of byInputs) add(ref);
    const all = [...chosen.values()].sort(byPath);
    const split = tally?.split(kind, listed, all, new Set(tests));
    const [run, leftOut] = [split?.run ?? all, split?.leftOut ?? []];
    const declaredOnly = byInputs.length === 0 ? {} : { byInputs: byInputs.sort(byPath) };
    picked.push({ runner, kind, adapter, listed, run, leftOut, ...declaredOnly });
  }
  const unknown = tests.filter((path) => !matched.has(path));
  if (unknown.length > 0) {
    throw new CollectUsageError(
      `--test ${unknown.join(", ")}: no Vitest or node:test project lists ${unknown.length === 1 ? "it" : "them"} as a test file`,
    );
  }
  return picked;
}

function byPath(a: TestFileRef, b: TestFileRef): number {
  return compare(a.path, b.path) || compare(a.project, b.project);
}

/** In `GATE_RUNNERS`' order, whatever order they ran in (D18); by path within each. */
function byRunnerAndPath(a: TestFileEvidence, b: TestFileEvidence): number {
  const runner = GATE_RUNNERS.indexOf(a.runner) - GATE_RUNNERS.indexOf(b.runner);
  return runner || compare(a.path, b.path);
}
