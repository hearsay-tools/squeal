import { existsSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  AbsolutePath,
  InvalidatedPath,
  PytestProject,
  RelativePath,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../../src/runners/pytest/adapter.js";
import {
  type CaseOutput,
  PYTHONS_VARIABLE,
  type PytestInput,
  type PytestPython,
  type Pythons,
} from "../case.js";
import { selectedOf, sortedRefs, storedOf } from "./reported.js";
import { writeTree } from "./shared.js";

/*
 * The `adapter:pytest` kind (011 C14, 007 D2 to D6, row 011-48): the tree's
 * pytest adapter over a fixture worktree, its environment one of the
 * comparison's synced Pythons (`python.ts`), declared from outside the
 * worktree so both trees key it alike. What the adapter decides before a
 * stored row is keys: each environment, the listed test files, each file's
 * closure (static, then with what its runs imported) and static checks, and
 * what a path's edit reaches. What a run reports is outputs, as the
 * scheduler stores it (`reported.ts`): a completed file whose run loaded a
 * start-up path its key lacked is withheld, as `rekeyEnvironments` stores
 * nothing for it (task 003-43), and a file whose module skipped itself is
 * named. Edits before a run are written and invalidated as a revision's
 * runner part; what `invalidate` and a quiet pass's `recheck` recreate is
 * keys. The run's failure and notes are wording. Admission's settling waits
 * on a clock that never sleeps.
 */

const PROJECT = "validity";

/** What the run of a pytest child must not inherit from the driver: another environment, Python and pytest settings. */
const DROPPED = /^(UV_|PYTHON|PYTEST_|VIRTUAL_ENV|CONDA_|SQUEAL_VALIDITY_)/;

/** The tracer's variables (`python/squeal_validity_trace.py`), for every pytest child. */
const TRACER = ["SQUEAL_VALIDITY_COVERAGE", "SQUEAL_VALIDITY_TRACED"];

/** The synced environment of `version`, or why there is none, thrown. */
function environmentOf(version: PytestPython): string {
  const found = (JSON.parse(process.env[PYTHONS_VARIABLE] ?? "{}") as Pythons)[version];
  if (found === undefined) throw new Error(`no Python ${version} environment for this comparison`);
  if ("reason" in found) throw new Error(`Python ${version} is unavailable: ${found.reason}`);
  return found.env;
}

const kept = (names: readonly string[], keep: (name: string) => boolean) =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name];
      return value === undefined || !keep(name) ? [] : [[name, value]];
    }),
  );

/** Admission's clock: each sleep moves time on at once. */
function instantClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

/** What the adapter decides before a row is stored, at one point of the case. */
async function decided(adapter: RunnerAdapter, affected: readonly RelativePath[]) {
  const environments = (await adapter.environment()).map(({ packages: _, ...e }) => e);
  const files = await adapter.testFiles();
  const closures: Record<string, readonly string[]> = {};
  const checks: Record<string, unknown> = {};
  for (const file of files) {
    closures[file.path] = (await adapter.closure(file)).paths;
    checks[file.path] = (await adapter.enumerate(file)).map((c) => ({
      check: JSON.stringify(c.check),
      location: c.location,
    }));
  }
  const reached: Record<string, unknown> = {};
  for (const path of affected) {
    const { direct, transitive } = await adapter.affected([path]);
    reached[path] = { direct: sortedRefs(direct), transitive: sortedRefs(transitive) };
  }
  return { environments, files: sortedRefs(files), closures, checks, affected: reached };
}

type Decided = Awaited<ReturnType<typeof decided>>;

/**
 * A run's report as stored: a completed file whose closure and environment
 * files, as keyed before the run, lack a path the run loaded at start-up
 * is withheld (`RunReport.environmentObserved`).
 */
function storedRun(report: RunReport, before: Decided) {
  const stored = storedOf(report);
  const loaded = (report.environmentObserved ?? []).flatMap((e) => e.paths);
  const environment = before.environments.flatMap((e) => e.files);
  const lacks = (file: TestFileRef) => {
    const keyed = new Set([...(before.closures[file.path] ?? []), ...environment]);
    return loaded.some((path) => !keyed.has(path));
  };
  const grown = new Set(sortedRefs(report.completedFiles.filter(lacks)));
  return {
    ...stored,
    completed: stored.completed.filter((file) => !grown.has(file)),
    withheld: [...new Set([...stored.withheld, ...grown])].sort(),
    skipped: sortedRefs((report.skippedFiles ?? []).map((s) => s.testFile)),
  };
}

/** Writes `edits` under `root`: a text, `null` to delete, absent to write the same bytes again. */
function write(root: string, edits: NonNullable<PytestInput["runs"][number]["edits"]>) {
  const invalidated: InvalidatedPath[] = [];
  for (const { path, text } of edits) {
    const file = join(root, path);
    const existed = existsSync(file);
    if (text === null) rmSync(file);
    else writeTree(root, { [path]: text ?? readFileSync(file, "utf8") });
    const kind =
      text === null ? "delete" : !existed ? "add" : text === undefined ? "touch" : "change";
    invalidated.push({ path, kind });
  }
  return invalidated;
}

/** Runs `input`'s runs in turn on one adapter over its fixture, under `scratch`. */
export async function pytestCase(input: PytestInput, scratch: string): Promise<CaseOutput> {
  const root = realpathSync(writeTree(join(scratch, "worktree"), input.files)) as AbsolutePath;
  const { project: entry = {} } = input;
  // D2's discovery finds the synced environment linked in as `.venv`; otherwise it is declared.
  if (input.venv === true) symlinkSync(environmentOf(input.python), join(root, ".venv"), "dir");
  const declared = input.venv === true ? {} : { python: environmentOf(input.python) };
  const project: PytestProject = {
    name: PROJECT,
    ...(entry.python === undefined ? declared : { python: entry.python }),
    args: entry.args ?? [],
    env: entry.env ?? {},
    include: entry.include ?? ["**/test_*.py"],
    ...(entry.exclude === undefined ? {} : { exclude: entry.exclude }),
  };
  const notes: string[] = [];
  const adapter = await createPytestAdapter(project, {
    root,
    source: {
      ...kept(Object.keys(process.env), (name) => !DROPPED.test(name)),
      PYTHONNOUSERSITE: "1",
    },
    note: (text) => notes.push(text),
    cacheDir: join(scratch, "cache") as AbsolutePath,
    childEnv: kept(TRACER, () => true),
    clock: instantClock(),
  });
  const ref = (path: string): TestFileRef => ({ project: PROJECT, path });
  const affected = input.affected ?? [];
  const steps: Decided[] = [];
  const runs: ReturnType<typeof storedRun>[] = [];
  const loaded: unknown[] = [];
  const recreated: unknown[] = [];
  const failures: (string | null)[] = [];
  try {
    steps.push(await decided(adapter, affected));
    for (const [at, run] of input.runs.entries()) {
      if (run.edits !== undefined) {
        recreated.push(await adapter.invalidate(write(root, run.edits)));
        steps.push(await decided(adapter, affected));
      }
      const checks = run.checks?.map(({ path, texts }) => ({ testFile: ref(path), texts }));
      const report = selectedOf(
        await adapter.run(run.files.map(ref), {
          runId: `validity-${at}`,
          logDir: join(scratch, "logs", String(at)),
          timeoutMs: run.timeoutMs ?? 60_000,
          ...(checks === undefined ? {} : { checks }),
        }),
        checks,
      );
      const before = steps[steps.length - 1] as Decided;
      runs.push(storedRun(report, before));
      loaded.push(report.environmentObserved ?? []);
      failures.push(report.failure);
      steps.push(await decided(adapter, affected));
    }
    recreated.push((await adapter.recheck?.()) ?? null);
  } finally {
    await adapter.close();
  }
  return {
    keys: { steps, loaded, recreated },
    outputs: { runs },
    wording: { failures, notes: notes.map((n) => n.replaceAll(root, "<root>")) },
  };
}
