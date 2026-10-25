import { existsSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  AbsolutePath,
  InvalidatedPath,
  PytestProject,
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
import { type Decided, decided, Kept, selectedOf, storedRun } from "./reported.js";
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
 * on a clock that never sleeps. A run's own deadline waits for the fixture's
 * proof (`heldDeadline`).
 */

const PROJECT = "validity";

/** What the run of a pytest child must not inherit from the driver: another environment, Python and pytest settings. */
const DROPPED = /^(UV_|PYTHON|PYTEST_|VIRTUAL_ENV|CONDA_|SQUEAL_VALIDITY_)/;

/** The tracer's variables (`python/squeal_validity_trace.py`), for every pytest child. */
const TRACER = ["SQUEAL_VALIDITY_COVERAGE", "SQUEAL_VALIDITY_TRACED"];

/** The file a fixture's test writes once the files before it have reported (row 011-142). */
const PROOF = "SQUEAL_VALIDITY_PROOF";

/** How long a held deadline waits for the proof before it fires and the case throws. */
const PROOF_LIMIT_MS = 60_000;

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

/**
 * `run` with the one timer of `ms` it sets, Squeal's deadline, held until
 * `proof` exists (row 011-142): the deadline fires at its time or at the
 * proof, whichever is later, so which files complete before the kill is the
 * fixture's to say, not the host's load. A run that sets no such timer, or a
 * proof absent after `PROOF_LIMIT_MS`, which fires it, throws.
 */
async function heldDeadline<T>(ms: number, proof: string, run: () => Promise<T>): Promise<T> {
  const real = globalThis.setTimeout;
  const since = performance.now();
  let set = 0;
  let late = false;
  let poll: NodeJS.Timeout | undefined;
  const hold = (fire: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== ms) return real(fire, delay, ...args);
    set += 1;
    const check = () => {
      const proven = existsSync(proof);
      late = !proven && performance.now() - since > PROOF_LIMIT_MS;
      if (proven || late) fire(...args);
      else poll = real(check, 20);
    };
    return real(check, ms);
  };
  globalThis.setTimeout = hold as typeof setTimeout;
  try {
    const result = await run();
    if (set !== 1) throw new Error(`the run set ${set} timers of ${ms} ms, not one deadline`);
    if (late) throw new Error(`the fixture wrote no proof in ${PROOF_LIMIT_MS} ms`);
    return result;
  } finally {
    globalThis.setTimeout = real;
    clearTimeout(poll);
  }
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
  const proof = join(scratch, "proof");
  const adapter = await createPytestAdapter(project, {
    root,
    source: {
      ...kept(Object.keys(process.env), (name) => !DROPPED.test(name)),
      PYTHONNOUSERSITE: "1",
    },
    note: (text) => notes.push(text),
    cacheDir: join(scratch, "cache") as AbsolutePath,
    childEnv: { ...kept(TRACER, () => true), [PROOF]: proof },
    clock: instantClock(),
  });
  const ref = (path: string): TestFileRef => ({ project: PROJECT, path });
  const affected = input.affected ?? [];
  const core = new Kept();
  const steps: Decided[] = [];
  const runs: ReturnType<typeof storedRun>[] = [];
  const loaded: unknown[] = [];
  const recreated: unknown[] = [];
  const failures: (string | null)[] = [];
  try {
    steps.push(await decided(adapter, affected, core));
    for (const [at, run] of input.runs.entries()) {
      if (run.edits !== undefined) {
        recreated.push(await adapter.invalidate(write(root, run.edits)));
        steps.push(await decided(adapter, affected, core));
      }
      const checks = run.checks?.map(({ path, texts }) => ({ testFile: ref(path), texts }));
      const ran = () =>
        adapter.run(run.files.map(ref), {
          runId: `validity-${at}`,
          logDir: join(scratch, "logs", String(at)),
          timeoutMs: run.timeoutMs ?? 60_000,
          ...(checks === undefined ? {} : { checks }),
        });
      rmSync(proof, { force: true });
      const report = selectedOf(
        await (run.timeoutMs === undefined ? ran() : heldDeadline(run.timeoutMs, proof, ran)),
        checks,
      );
      const before = steps[steps.length - 1] as Decided;
      runs.push(storedRun(report, before));
      core.add(report);
      loaded.push(report.environmentObserved ?? []);
      failures.push(report.failure);
      steps.push(await decided(adapter, affected, core));
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
