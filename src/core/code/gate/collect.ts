import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, POLICY_FILE } from "../../daemon/policy.js";
import { vitestDetected } from "../../daemon/runner.js";
import { compare } from "../../fs/compare.js";
import { findWorktreeRoot } from "../../fs/git-layout.js";
import { readObjectFormat } from "../../hash/git-index.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { NodeTestProject, Policy, PolicyInputs } from "../../types/policy.js";
import type {
  RunnerAdapter,
  RunnerClosure,
  RunnerEnvironment,
  RunReport,
} from "../../types/runner.js";
import type { BlobCache } from "../coverage/record.js";
import { coverageProvider, PROVIDER_MISSING_NOTE } from "../coverage/runtime.js";
import type { CoverageRun, CoveredFile } from "../coverage/types.js";
import { type Mapped, mapPayloads, refKey } from "./records.js";
import type { ChangedSet, Evidence, TestFileEvidence } from "./types.js";

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

/**
 * The two adapters' constructors, `createVitestAdapter` and
 * `createNodeTestAdapter`, given by the caller: no file under
 * `src/core/code` imports a runner's folder (row 016-36). Typed by what the
 * collector passes, so each constructor fits as it is.
 */
export interface GateAdapters {
  readonly vitest: (options: {
    readonly root: AbsolutePath;
    readonly note: (text: string) => void;
    readonly excludeProjects: () => readonly string[];
    readonly exclude: () => readonly string[];
    /** D3.5: no results cache written into the project. */
    readonly cache: false;
    readonly coverage: {
      readonly enabled: () => boolean;
      /** D12: `coverage.children` at the base. */
      readonly children: () => boolean;
      readonly provider: AbsolutePath;
      readonly tempDir: AbsolutePath;
      readonly collected: (run: CoverageRun) => void;
    };
  }) => Promise<RunnerAdapter>;
  readonly nodeTest: (
    project: NodeTestProject,
    options: {
      readonly root: AbsolutePath;
      readonly note: (text: string) => void;
      readonly concurrency: () => number;
      readonly inputs: () => PolicyInputs;
      readonly tempDir: AbsolutePath;
      readonly coverage: {
        readonly enabled: () => boolean;
        /** D12: `coverage.children` at the base. */
        readonly children: () => boolean;
        readonly collected: (run: CoverageRun) => void;
      };
    },
  ) => Promise<RunnerAdapter>;
}

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
}

/**
 * The evidence of each of `files` known without a run, from the stores
 * (D11.7) or `ci record`'s parts (D13.2), by the ref given; a file it
 * leaves out runs. Called once per runner with a selected file, before its
 * run and within the budget. `closure`, which the collector always gives,
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

/** The failed name of a completed file's import or syntax failure, which has no test name. */
export const FILE_ERROR = "(file-level error)";

/** One opened adapter and the payloads its runs handed over. */
interface Runner {
  readonly kind: TestFileEvidence["runner"];
  readonly adapter: RunnerAdapter;
  readonly covered: CoveredFile[];
}

/**
 * The evidence of `changed`'s functions: per selected test file, whether it
 * completed before the deadline, its failed tests, the sources its closure
 * loads and its record. The test files are selected from `changed.paths`,
 * every changed path, not from the changed functions (D3.1). The budget
 * counts from the call, the adapters' start included. The runs go one
 * runner after another, each given what is left of it; a runner reached
 * after the deadline runs nothing. A project's own `testTimeout` is never
 * lowered. With no changed path and no `--test` file, no adapter starts.
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
  if (paths.length === 0 && options.tests.length === 0) {
    return { testFiles: [], timedOut: false, budgetSeconds: options.budgetSeconds };
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
    const opening = { provider, temp, note, children };
    await openRunners(options.adapters, root, policy, opening, runners);
    const selected = await select(runners, paths, options.tests);
    const blobs: BlobCache = new Map();
    const testFiles: TestFileEvidence[] = [];
    let timedOut = false;
    for (const [i, runner] of runners.entries()) {
      const chosen = selected[i] ?? [];
      if (chosen.length === 0) continue;
      const closure = (ref: TestFileRef) => runner.adapter.closure(ref).catch(() => null);
      const environment = () => runner.adapter.environment();
      const stored =
        (await options.stored?.(runner.kind, chosen, closure, environment)) ?? new Map();
      testFiles.push(...stored.values());
      const files = chosen.filter((ref) => !stored.has(ref));
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
      for (const ref of files) {
        testFiles.push(await evidenceOf(runner, ref, report, records, children));
      }
    }
    return {
      testFiles: testFiles.sort(byRunnerAndPath),
      timedOut,
      budgetSeconds: options.budgetSeconds,
    };
  } finally {
    await Promise.allSettled(runners.map((r) => r.adapter.close()));
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * Vitest when the daemon would run it (`vitestDetected`, or no other runner
 * configured), then each `nodeTest` project, in the policy's order. Each
 * adapter opened is pushed at once, so a later failure still closes it.
 */
async function openRunners(
  adapters: GateAdapters,
  root: AbsolutePath,
  policy: Policy,
  {
    provider,
    temp,
    note,
    children,
  }: {
    provider: AbsolutePath;
    temp: AbsolutePath;
    note: (text: string) => void;
    children: boolean;
  },
  runners: Runner[],
): Promise<void> {
  if (policy.nodeTest.length + policy.pytest.length === 0 || vitestDetected(root)) {
    const covered: CoveredFile[] = [];
    const collected = (run: CoverageRun) => covered.push(...run.files);
    const adapter = await adapters.vitest({
      root,
      note,
      excludeProjects: () => policy.vitest.excludeProjects,
      exclude: () => policy.vitest.exclude,
      cache: false,
      coverage: {
        enabled: () => true,
        children: () => children,
        provider,
        tempDir: temp,
        collected,
      },
    });
    runners.push({ kind: "vitest", adapter, covered });
  }
  for (const project of policy.nodeTest) {
    const covered: CoveredFile[] = [];
    const collected = (run: CoverageRun) => covered.push(...run.files);
    const adapter = await adapters.nodeTest(project, {
      root,
      note,
      // One process per file, `runner.tierSize` at once, as the daemon's edit tiers run.
      concurrency: () => policy.runner.tierSize,
      inputs: () => policy.inputs,
      tempDir: temp,
      coverage: { enabled: () => true, children: () => children, collected },
    });
    runners.push({ kind: "node-test", adapter, covered });
  }
}

/**
 * D3.1, per runner: the test files `affected()` gives for the changed
 * paths, its test files among them, and the `--test` files it lists.
 * Throws `CollectUsageError` for a `--test` file no runner lists.
 */
async function select(
  runners: readonly Runner[],
  paths: readonly RelativePath[],
  tests: readonly RelativePath[],
): Promise<TestFileRef[][]> {
  const named = new Set([...paths, ...tests]);
  const matched = new Set<RelativePath>();
  const selected: TestFileRef[][] = [];
  for (const { adapter } of runners) {
    const chosen = new Map<string, TestFileRef>();
    const add = (ref: TestFileRef) => chosen.set(refKey(ref), ref);
    for (const ref of await adapter.testFiles()) {
      if (named.has(ref.path)) add(ref);
      matched.add(ref.path);
    }
    if (paths.length > 0) {
      const affected = await adapter.affected(paths);
      for (const ref of [...affected.direct, ...affected.transitive]) add(ref);
    }
    selected.push([...chosen.values()].sort(byPath));
  }
  const unknown = tests.filter((path) => !matched.has(path));
  if (unknown.length > 0) {
    throw new CollectUsageError(
      `--test ${unknown.join(", ")}: no Vitest or node:test project lists ${unknown.length === 1 ? "it" : "them"} as a test file`,
    );
  }
  return selected;
}

/**
 * One selected file's evidence; a file that did not complete keeps no
 * failure, no skip and no record. A skipped test is D11.3's: its record
 * proves a pass and never a violation. With `children`, its child files
 * are counted, none when it has no record.
 */
async function evidenceOf(
  runner: Runner,
  ref: TestFileRef,
  report: RunReport | null,
  records: ReadonlyMap<string, Mapped>,
  children: boolean,
): Promise<TestFileEvidence> {
  const key = refKey(ref);
  const completed = report?.completedFiles.some((done) => refKey(done) === key) === true;
  const own = (r: { testFile: TestFileRef }) => refKey(r.testFile) === key;
  const results = !completed
    ? []
    : (report?.results ?? []).filter(
        (r) => r.check.project === ref.project && r.check.testPath === ref.path,
      );
  const failed = [
    ...(completed && report?.fileErrors.some(own) === true ? [FILE_ERROR] : []),
    ...results.filter((r) => r.outcome === "fail").map((r) => r.check.fullName),
  ];
  const skipped = results.some((r) => r.outcome === "skip");
  const loads = await runner.adapter.closure(ref).then(
    (closure) => [...closure.paths].sort(compare),
    () => null,
  );
  const mapped = completed ? records.get(key) : undefined;
  const record = mapped?.record ?? null;
  const counts = children ? { children: mapped?.children ?? { read: 0, dropped: 0 } } : {};
  return {
    runner: runner.kind,
    path: ref.path,
    completed,
    failed,
    skipped,
    loads,
    record,
    ...counts,
  };
}

function byPath(a: TestFileRef, b: TestFileRef): number {
  return compare(a.path, b.path) || compare(a.project, b.project);
}

/** Vitest first, then node:test, as they run; by path within each. */
const RUNNER_ORDER: readonly TestFileEvidence["runner"][] = ["vitest", "node-test"];

function byRunnerAndPath(a: TestFileEvidence, b: TestFileEvidence): number {
  const runner = RUNNER_ORDER.indexOf(a.runner) - RUNNER_ORDER.indexOf(b.runner);
  return runner || compare(a.path, b.path);
}
