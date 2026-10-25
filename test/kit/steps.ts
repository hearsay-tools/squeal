import { existsSync, rmSync, statSync, utimesSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
  AffectedTestFiles,
  CancelCause,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";
import type { FixtureFiles } from "./files.js";
import { isTest, type Module, type Outcome, type Step } from "./scenarios/index.js";

/*
 * Spec 016 D1: how the driver plays each step of a scenario through an
 * opened adapter. It names no runner: paths and texts come from the pack.
 */

/** What a step needs of the scenario being played. */
export interface Stage {
  readonly files: FixtureFiles;
  readonly dir: string;
  readonly adapter: RunnerAdapter;
  readonly modules: ReadonlyMap<string, Module>;
  readonly tests: readonly string[];
  readonly pathOf: (name: string) => string;
  readonly ref: (name: string) => TestFileRef;
  readonly fullName: (check: string) => string;
  /** The cause a held run is cut for. */
  readonly cut: CancelCause;
  /** Writes the module's text at its path. */
  readonly write: (name: string, module: Exclude<Module, { kind: "absent" }>) => void;
  /** Records one assertion. */
  readonly say: (pass: boolean, text: string) => void;
  readonly note: (text: string) => void;
}

/** The step's run, or the last run before it; `null` before any. */
export type Last = RunReport | null;

function outcomeOf(report: RunReport, file: TestFileRef, fullName: string): Outcome {
  const same = (ref: TestFileRef) => ref.project === file.project && ref.path === file.path;
  if (!report.completedFiles.some(same)) return "unknown";
  if (report.fileErrors.some((e) => same(e.testFile))) return "file-error";
  const result = report.results.find(
    ({ check }) =>
      check.kind === "test" &&
      check.project === file.project &&
      check.testPath === file.path &&
      check.fullName === fullName,
  );
  return result?.outcome ?? "absent";
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Aborts `abort` once `marker` exists, unless `ended` first; a cut that never came reads in the run's outcomes. */
async function cutAt(marker: string, ended: () => boolean, abort: () => void): Promise<void> {
  for (const end = Date.now() + 60_000; Date.now() < end && !ended(); await delay(20)) {
    if (existsSync(marker)) return abort();
  }
}

async function run(stage: Stage, at: number, step: Extract<Step, { run: true }>): Promise<Last> {
  const { adapter, tests, ref } = stage;
  // Spec 016 D2: a directory no earlier run used, as the daemon gives.
  const options = { runId: `run-${at}`, logDir: join(stage.dir, "logs", `run-${at}`) };
  let report: RunReport;
  if (step.cut === undefined) {
    report = await adapter.run(tests.map(ref), { ...options, timeoutMs: 120_000 });
  } else {
    const held = stage.modules.get(step.cut);
    if (held?.kind !== "held") throw new Error(`${step.cut} is no held module`);
    const marker = stage.files.at(`${held.holds}.started`);
    rmSync(marker, { force: true });
    const signal = new AbortController();
    const stop = new AbortController();
    let ended = false;
    const by = stage.cut;
    const running = adapter
      .run(tests.map(ref), {
        ...options,
        timeoutMs: 120_000,
        signal: signal.signal,
        stop: stop.signal,
      })
      .finally(() => {
        ended = true;
      });
    await cutAt(
      marker,
      () => ended,
      () => {
        if (by === "stop") stop.abort(by);
        signal.abort(by);
      },
    );
    report = await running;
    stage.note(`step ${at} cut for ${by}: ${signal.signal.aborted ? "aborted" : "never started"}`);
  }
  if (report.failure !== null) stage.note(`step ${at} failure: ${report.failure}`);
  for (const [name, expected] of Object.entries(step.expect)) {
    const module = stage.modules.get(name);
    if (module === undefined || !isTest(module)) throw new Error(`${name} is no test module`);
    const got = outcomeOf(report, ref(name), stage.fullName(module.check));
    stage.say(
      got === expected,
      `step ${at} run (${report.end}): ${name} is ${got}, expected ${expected}`,
    );
  }
  return report;
}

/** The directories a lookup from `from` tries, nearest first, as `PackageImport` has it. */
function lookups(from: string): string[] {
  const parts = from === "" ? [] : from.split("/");
  return parts.map((_, at) => `${parts.slice(0, parts.length - at).join("/")}/`).concat("");
}

/** Whether `edited` is in an installed package `imports` names. */
function installs(edited: string, imports: readonly { from: string; name: string }[]): boolean {
  return imports.some(({ from, name }) =>
    lookups(from).some((dir) => edited.startsWith(`${dir}node_modules/${name}/`)),
  );
}

/** What an edit did to the adapter's view, as a revision or a quiet pass hands it over. */
interface Seen {
  readonly edited: string;
  readonly affected: AffectedTestFiles;
  /** Projects recreated with another environment. */
  readonly recreated: readonly string[];
  /** Projects whose environment files hold the edited path, which the core hashes into their key. */
  readonly keyed: readonly string[];
  readonly last: Last;
}

/** How the edit reaches test module `name`, as one assertion's text, and whether it does. */
async function reach(stage: Stage, seen: Seen, name: string): Promise<[boolean, string]> {
  const ref = stage.ref(name);
  const same = (f: TestFileRef) => f.path === ref.path;
  const { edited } = seen;
  const by = seen.affected.direct.some(same)
    ? "direct"
    : seen.affected.transitive.some(same)
      ? "transitive"
      : "none";
  const closure = await stage.adapter.closure(ref);
  const held = closure.paths.includes(edited);
  const named = installs(edited, closure.packages?.imports ?? []);
  const observed = (seen.last?.observed ?? []).some(
    (o) => same(o.testFile) && o.paths.includes(edited),
  );
  const recreated = seen.recreated.includes(ref.project);
  const keyed = seen.keyed.includes(ref.project);
  return [
    by !== "none" || held || named || observed || recreated || keyed,
    `affected=${by}, closure=${held}, package=${named}, observed=${observed}, recreated=${recreated}, environment=${keyed}`,
  ];
}

/**
 * Hands the edit of `edited` to the adapter: a path in the worktree as a
 * revision does, `invalidate` and `affected`; one outside it as a quiet
 * pass does, `recheck` alone, since no revision names it (007 wave 2 B1).
 */
async function hand(stage: Stage, edited: string, added: boolean, last: Last): Promise<Seen> {
  const { adapter } = stage;
  const before = JSON.stringify(await adapter.environment());
  const none = { direct: [], transitive: [] };
  const inside = !isAbsolute(edited);
  const result = inside
    ? await adapter.invalidate([{ path: edited, kind: added ? "add" : "change" }])
    : await adapter.recheck?.();
  const affected = inside ? await adapter.affected([edited]) : none;
  const environments = await adapter.environment();
  const moved = JSON.stringify(environments) !== before;
  return {
    edited,
    affected,
    recreated: moved ? (result?.recreatedProjects ?? []) : [],
    keyed: environments.filter((e) => e.files.includes(edited)).map((e) => e.project),
    last,
  };
}

async function edit(stage: Stage, at: number, step: Extract<Step, { edit: string }>, last: Last) {
  const edited = stage.pathOf(step.edit);
  const file = stage.files.at(edited);
  const before = existsSync(file) ? statSync(file) : null;
  stage.write(step.edit, step.to);
  if (step.sameStat === true) {
    if (before === null || statSync(file).size !== before.size) {
      throw new Error(`step ${at} edit ${edited} changes the size it is to keep`);
    }
    utimesSync(file, before.atime, before.mtime);
  }
  const seen = await hand(stage, edited, before === null, last);
  for (const name of step.reaches) {
    const [reached, how] = await reach(stage, seen, name);
    stage.say(reached, `step ${at} edit ${edited}: reaches ${name} by ${how}`);
  }
}

async function lacks(stage: Stage, at: number, step: Extract<Step, { lacks: string }>) {
  const path = stage.pathOf(step.lacks);
  const listed = (await stage.adapter.environment()).some((e) => e.files.includes(path));
  for (const name of step.of) {
    const held = (await stage.adapter.closure(stage.ref(name))).paths.includes(path);
    stage.say(
      !held && !listed,
      `step ${at} before any run: ${path} is in no static closure of ${name} (closure=${held}, environment=${listed})`,
    );
  }
}

/** Plays `step`, the `at`th, after `last`; returns the last run. */
export async function playStep(stage: Stage, at: number, step: Step, last: Last): Promise<Last> {
  if ("run" in step) return run(stage, at, step);
  if ("edit" in step) await edit(stage, at, step, last);
  else await lacks(stage, at, step);
  return last;
}
