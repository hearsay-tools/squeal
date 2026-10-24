import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AbsolutePath,
  RunnerAdapter,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";
import { isTest, type Module, type Outcome, type Scenario } from "./scenarios/index.js";

/*
 * Spec 016 D1: the kit's driver. It writes a scenario's fixture with a
 * pack, then drives the pack's adapter through `RunnerAdapter` alone: list,
 * run, edit, `invalidate`, `affected`, `closure`, run again. It starts no
 * daemon and touches no store, so it checks outcomes and reach; transitions
 * are the core's. It names no runner: everything a runner knows is its pack.
 */

/** What a runner gives to join the kit (spec 016 D1). */
export interface Pack {
  readonly name: string;
  /** Where module `name` lives, relative to the fixture root. */
  readonly path: (name: string, module: Module) => string;
  /** The module's text in the runner's language. */
  readonly text: (module: Module) => string;
  /** The full name of check `check` as the runner reports it. */
  readonly fullName: (check: string) => string;
  /** The project's own files, by path from the fixture root. */
  readonly project: Readonly<Record<string, string>>;
  /** Opens the adapter over the written fixture; `scratch` is the scenario's own directory. */
  readonly open: (root: AbsolutePath, scratch: AbsolutePath) => Promise<RunnerAdapter>;
  /** Scenarios the runner is documented not to meet, by scenario name. */
  readonly known?: Readonly<Record<string, Gap>>;
}

/** A scenario a runner is documented not to meet (spec 016 D1). */
export interface Gap {
  /** The spec line that documents it. */
  readonly spec: string;
  /**
   * The assertions it fails, each as a text its line holds, such as
   * `step 2 run`. Any other failed assertion, and any error the driver
   * caught, reads FAIL.
   */
  readonly fails: readonly string[];
}

/**
 * PASS: the expected outcome. FAIL: anything else. KNOWN: a listed gap
 * failed only its listed assertions. UNEXPECTED PASS: a listed gap passed.
 */
export type Verdict = "PASS" | "FAIL" | "KNOWN" | "UNEXPECTED PASS";

export interface Played {
  readonly scenario: string;
  readonly pack: string;
  readonly verdict: Verdict;
  /** The spec line of a listed gap. */
  readonly known: string | undefined;
  /** One line per assertion, `ok` or `FAIL`, and notes. */
  readonly lines: readonly string[];
}

/** `failed`: the lines of the failed assertions; `errored`: the driver caught an error. */
export function verdictOf(
  failed: readonly string[],
  errored: boolean,
  gap: Gap | undefined,
): Verdict {
  if (errored) return "FAIL";
  if (gap === undefined) return failed.length === 0 ? "PASS" : "FAIL";
  if (failed.length === 0) return "UNEXPECTED PASS";
  const listed = (line: string) => gap.fails.some((text) => line.includes(text));
  return failed.every(listed) ? "KNOWN" : "FAIL";
}

/** A kit test passes on PASS and KNOWN alone, so a gap that closed fails until it is unlisted. */
export const accepted = (verdict: Verdict): boolean => verdict === "PASS" || verdict === "KNOWN";

/** The played scenario as a failure message reads it. */
export function describePlayed(played: Played): string {
  const gap = played.known === undefined ? "" : ` (listed gap: ${played.known})`;
  return [`${played.verdict} ${played.scenario} × ${played.pack}${gap}`, ...played.lines].join(
    "\n",
  );
}

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

const errorText = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Plays `scenario` through `pack` in a fresh directory under `scratch`. */
export async function play(scenario: Scenario, pack: Pack, scratch: string): Promise<Played> {
  const dir = join(scratch, `${scenario.name}-${pack.name}`);
  const fixture = join(dir, "worktree");
  mkdirSync(fixture, { recursive: true });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    writeFileSync(join(fixture, path), text);
  };
  const modules = new Map(Object.entries(scenario.modules));
  const pathOf = (name: string) => {
    const module = modules.get(name);
    if (module === undefined) throw new Error(`${scenario.name} has no module ${name}`);
    return pack.path(name, module);
  };
  for (const [path, text] of Object.entries(pack.project)) write(path, text);
  for (const [name, module] of modules) write(pathOf(name), pack.text(module));
  const tests = [...modules].filter(([, m]) => isTest(m)).map(([name]) => name);

  const lines: string[] = [];
  const failed: string[] = [];
  let errored = false;
  const say = (pass: boolean, text: string) => {
    if (!pass) failed.push(text);
    lines.push(`${pass ? "ok  " : "FAIL"} ${text}`);
  };
  const caught = (text: string) => {
    errored = true;
    lines.push(`FAIL ${text}`);
  };
  let adapter: RunnerAdapter | null = null;
  try {
    adapter = await pack.open(realpathSync(fixture), realpathSync(dir));
    const opened = adapter;
    const listed = await opened.testFiles();
    say(
      tests.every((t) => listed.some((f) => f.path === pathOf(t))),
      `lists ${tests.map(pathOf).join(", ")} (got ${listed.map((f) => f.path).join(", ")})`,
    );
    const ref = (name: string): TestFileRef => {
      const found = listed.find((f) => f.path === pathOf(name));
      if (found === undefined) throw new Error(`${pathOf(name)} is not listed`);
      return found;
    };
    let last: RunReport | null = null;
    for (const [at, step] of scenario.steps.entries()) {
      if ("run" in step) {
        // Spec 016 D2: a directory no earlier run used, as the daemon gives.
        const logDir = join(dir, "logs", `run-${at}`);
        last = await opened.run(tests.map(ref), { runId: `run-${at}`, logDir, timeoutMs: 120_000 });
        if (last.failure !== null) lines.push(`note step ${at} failure: ${last.failure}`);
        for (const [name, expected] of Object.entries(step.expect)) {
          const module = modules.get(name);
          if (module === undefined || !isTest(module)) throw new Error(`${name} is no test module`);
          const got = outcomeOf(last, ref(name), pack.fullName(module.check));
          say(
            got === expected,
            `step ${at} run (${last.end}): ${name} is ${got}, expected ${expected}`,
          );
        }
      } else {
        const edited = pathOf(step.edit);
        write(edited, pack.text(step.to));
        await opened.invalidate([{ path: edited, kind: "change" }]);
        const affected = await opened.affected([edited]);
        for (const name of step.reaches) {
          const path = pathOf(name);
          const by = affected.direct.some((f) => f.path === path)
            ? "direct"
            : affected.transitive.some((f) => f.path === path)
              ? "transitive"
              : "none";
          const closure = (await opened.closure(ref(name))).paths.includes(edited);
          const observed = (last?.observed ?? []).some(
            (o) => o.testFile.path === path && o.paths.includes(edited),
          );
          say(
            by !== "none" || closure || observed,
            `step ${at} edit ${edited}: reaches ${name} by affected=${by}, closure=${closure}, observed=${observed}`,
          );
        }
      }
    }
  } catch (error) {
    caught(`threw: ${errorText(error)}`);
  } finally {
    try {
      await adapter?.close();
    } catch (error) {
      caught(`close threw: ${errorText(error)}`);
    }
  }
  return playedOf(scenario, pack, { failed, errored, lines });
}

function playedOf(
  scenario: Scenario,
  pack: Pack,
  run: { failed: readonly string[]; errored: boolean; lines: readonly string[] },
): Played {
  const gap = pack.known?.[scenario.name];
  const verdict = verdictOf(run.failed, run.errored, gap);
  return { scenario: scenario.name, pack: pack.name, verdict, known: gap?.spec, lines: run.lines };
}
