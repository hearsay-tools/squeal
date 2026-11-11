import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, POLICY_FILE } from "../../daemon/policy.js";
import { compare } from "../../fs/compare.js";
import { findWorktreeRoot } from "../../fs/git-layout.js";
import { readObjectFormat } from "../../hash/git-index.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunnerClosure, RunnerEnvironment, RunReport } from "../../types/runner.js";
import type { BlobCache } from "../coverage/record.js";
import { coverageProvider, PROVIDER_MISSING_NOTE } from "../coverage/runtime.js";
import type { RunEstimate } from "./estimate.js";
import { evidenceOf, leftOutFiles } from "./evidence.js";
import { inLoaderOrder, orderRuns } from "./plan.js";
import type { BasePrepares, PrepareRun } from "./prepare.js";
import { type Picked, type SelectionSummary, tellSelection } from "./prerun.js";
import { type Mapped, mapPayloads } from "./records.js";
import { type GateAdapters, openRunners, type Runner } from "./runners.js";
import { type GateScope, type LeftOutFile, type ScopeTally, tallyScope } from "./scope.js";
import { preparedBefore, storedOf, tellEstimates, tellRan } from "./steps.js";
import { type ChangedSet, type Evidence, GATE_RUNNERS, type TestFileEvidence } from "./types.js";

/*
 * Spec 020 D3 (row 020-03): the one-shot collector. It opens the project's
 * own Vitest and node:test adapters with Squeal's coverage provider, as the
 * daemon builds them (015 D8), with no daemon and no store; selects the
 * test files that load a changed path, every changed test file and the
 * `--test` files; runs them under one deadline; and maps each completed
 * file's payload to its record before the adapter closes, which deletes it.
 * D12 (row 020-10b): with `coverage.children` at the base, the runners
 * collect the coverage of the processes and threads the tests start too.
 */

export interface CollectOptions {
  /** `--test` files, relative to the worktree root (D3.1). */
  readonly tests: readonly RelativePath[];
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
   * D17.3: told each runner's run once it ended, before the next starts;
   * with it, Vitest records runtime reads as the worktree's daemon does.
   */
  readonly ran?: (run: GateRun) => Promise<void>;
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
 * counts from the call, the adapters' start included. The runs go one
 * runner after another, the one with the smaller estimate first (D18),
 * each given what is left of it; a runner reached after the deadline runs
 * nothing. A project's own `testTimeout` is never lowered. With no changed
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
  const deadline = performance.now() + options.budgetSeconds * 1000;
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
    const opening = { provider, temp, note, children, keeping: options.ran !== undefined };
    await openRunners(options.adapters, root, policy, opening, runners);
    const picked = await select(runners, paths, options.tests, tally);
    const at = { root, deadline, note, options, children };
    // Review 0.1.432 B2: the stores and the parts first, so the print names only what runs.
    const known = await storedOf(picked, options);
    // D18: the runners in the order they run, which the print follows (D18.4); no closure read.
    const { durations } = options;
    const order = orderRuns(picked, known, { durations, tierSize: policy.runner.tierSize });
    const inOrder = order.runs.map((run) => run.pick);
    await tellSelection(options.selected, inOrder, changed, { ...options, tally, known });
    const runs = await inLoaderOrder(order.runs, { changed: paths, durations });
    const estimates = tellEstimates(options.estimated, order.estimates, deadline);
    const blobs: BlobCache = new Map();
    const testFiles: TestFileEvidence[] = [];
    const prepares: PrepareRun[] = [];
    let timedOut = false;
    for (const { pick, index: i, files: toRun } of runs) {
      const { runner, run: chosen } = pick;
      if (chosen.length === 0) continue;
      const before = await preparedBefore(runner, chosen, at);
      prepares.push(...before.prepares);
      timedOut ||= before.budgetEnded;
      testFiles.push(...chosen.flatMap((ref) => before.known.get(ref) ?? known.get(ref) ?? []));
      // D17.2: the files left to run, in loader order.
      const files = toRun.filter((ref) => !before.known.has(ref));
      if (files.length === 0) continue;
      const left = Math.ceil(deadline - performance.now());
      const logDir = join(temp, "runs", String(i));
      const report =
        left > 0
          ? await runner.adapter.run(files, { runId: `gate-${i}`, logDir, timeoutMs: left })
          : null;
      timedOut ||= report === null || report.end === "timed-out";
      if (report?.failure != null) note(`${runner.kind} run: ${report.failure}`);
      const mapping = { format, blobs, provider, children, note };
      const records = mapPayloads(runner.covered.splice(0), mapping);
      await tellRan(options.ran, { runner: runner.kind, files, report, records });
      for (const ref of files) {
        testFiles.push(await evidenceOf(runner, ref, report, records, children));
      }
    }
    return {
      testFiles: testFiles.sort(byRunnerAndPath),
      timedOut,
      budgetSeconds: options.budgetSeconds,
      ...scoped(await leftOutFiles(picked)),
      ...(prepares.length === 0 ? {} : { prepares }),
      ...estimates,
    };
  } finally {
    await Promise.allSettled(runners.map((r) => r.adapter.close()));
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * D3.1, per runner: the test files `affected()` gives for the changed
 * paths, its test files among them, and the `--test` files it lists.
 * Throws `CollectUsageError` for a `--test` file no runner lists. D14.2:
 * with a scope's `tally`, the files it leaves out are the pick's `leftOut`
 * instead of its `run`.
 */
async function select(
  runners: readonly Runner[],
  paths: readonly RelativePath[],
  tests: readonly RelativePath[],
  tally: ScopeTally | null,
): Promise<(Picked & { readonly runner: Runner })[]> {
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
    const all = [...chosen.values()].sort(byPath);
    const split = tally?.split(kind, listed, all, new Set(tests));
    const [run, leftOut] = [split?.run ?? all, split?.leftOut ?? []];
    picked.push({ runner, kind, adapter, listed, run, leftOut });
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
