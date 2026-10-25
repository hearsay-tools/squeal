import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type {
  AbsolutePath,
  CancelCause,
  RunnerAdapter,
  TestFileRef,
} from "../../src/core/types/index.js";
import { FixtureFiles } from "./files.js";
import { isTest, type Module, type Scenario, type Written } from "./scenarios/index.js";
import { type Last, playStep, type Stage } from "./steps.js";

/*
 * Spec 016 D1: the kit's driver. It writes a scenario's fixture with a
 * pack, then drives the pack's adapter through `RunnerAdapter` alone: list,
 * run, edit, `invalidate`, `affected`, `closure`, run again. It starts no
 * daemon and touches no store, so it checks outcomes and reach; transitions
 * are the core's. It names no runner: everything a runner knows is its pack.
 */

/** What the pack opens over, beyond the files it wrote. */
export interface Fixture {
  /** The paths of the scenario's `hook` modules: the runner loads each before every test file. */
  readonly hooks: readonly string[];
}

/** What a runner gives to join the kit (spec 016 D1). */
export interface Pack {
  readonly name: string;
  /**
   * Where module `name` lives: from the fixture root, or an absolute path
   * outside the worktree, which a revision never names.
   */
  readonly path: (name: string, module: Module) => string;
  /** The module's text in the runner's language; `of` is any module of the scenario by name. */
  readonly text: (module: Written, of: (name: string) => Module) => string;
  /**
   * Files written beside module `name` each time it is written, by path as
   * `path` gives one, such as an install's metadata; a later write removes
   * those it no longer lists.
   */
  readonly beside?: (name: string, module: Written) => Readonly<Record<string, string>>;
  /** The full name of check `check` as the runner reports it. */
  readonly fullName: (check: string) => string;
  /** The project's own files, by path from the fixture root. */
  readonly project: Readonly<Record<string, string>>;
  /** Opens the adapter over the written fixture; `scratch` is the scenario's own directory. */
  readonly open: (
    root: AbsolutePath,
    scratch: AbsolutePath,
    fixture: Fixture,
  ) => Promise<RunnerAdapter>;
  /**
   * The cause the driver cuts a held run for. Default `stop`, which every
   * adapter honours; under another an adapter may run to the end
   * (`RunOptions.signal`).
   */
  readonly cut?: CancelCause;
  /** Scenarios the runner is documented not to meet, by scenario name. */
  readonly known?: Readonly<Record<string, Gap>>;
  /**
   * Per-runner forms of some scenarios, each played besides the pack's own
   * form: where runner knowledge lives (spec 016 D1).
   */
  readonly variants?: readonly Variant[];
}

/** A per-runner form of some scenarios (spec 016 D1). */
export interface Variant {
  /** What it changes, as a test's title reads it, such as `--require`. */
  readonly name: string;
  /** The scenarios it plays, by name. */
  readonly scenarios: readonly string[];
  /** The pack they play through: the runner's pack with the variant's forms, and its own `known`. */
  readonly pack: Pack;
}

/** One way a kit file plays a scenario: through the pack, or through one of its variants. */
export interface Form {
  readonly scenario: Scenario;
  /** The variant's name; absent for the pack's own form. */
  readonly variant: string | undefined;
  readonly pack: Pack;
}

/** Every scenario through `pack`, each followed by the variants that play it. */
export function forms(scenarios: readonly Scenario[], pack: Pack): Form[] {
  return scenarios.flatMap((scenario) => [
    { scenario, variant: undefined, pack },
    ...(pack.variants ?? [])
      .filter((variant) => variant.scenarios.includes(scenario.name))
      .map((variant) => ({ scenario, variant: variant.name, pack: variant.pack })),
  ]);
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

const errorText = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Plays `scenario` through `pack` in a fresh directory under `scratch`. */
export async function play(scenario: Scenario, pack: Pack, scratch: string): Promise<Played> {
  const dir = join(scratch, `${scenario.name}-${pack.name.replace(/\W+/g, "-")}`);
  mkdirSync(join(dir, "worktree"), { recursive: true });
  const files = new FixtureFiles(realpathSync(join(dir, "worktree")));
  const modules = new Map(Object.entries(scenario.modules));
  const pathOf = (name: string) => {
    const module = modules.get(name);
    if (module === undefined) throw new Error(`${scenario.name} has no module ${name}`);
    return pack.path(name, module);
  };
  const of = (name: string) => {
    const module = modules.get(name);
    if (module === undefined) throw new Error(`${scenario.name} has no module ${name}`);
    return module;
  };
  /** What an install wrote beside each module, so the next one removes what it no longer lists. */
  const besides = new Map<string, readonly string[]>();
  const write = (name: string, module: Written) => {
    files.put(pathOf(name), pack.text(module, of));
    const beside = pack.beside?.(name, module) ?? {};
    for (const path of besides.get(name) ?? []) if (!(path in beside)) files.remove(path);
    for (const [path, text] of Object.entries(beside)) files.put(path, text);
    besides.set(name, Object.keys(beside));
  };
  for (const [path, text] of Object.entries(pack.project)) files.put(path, text);
  for (const [name, module] of modules) if (module.kind !== "absent") write(name, module);
  const tests = [...modules].filter(([, m]) => isTest(m)).map(([name]) => name);
  const hooks = [...modules].filter(([, m]) => m.kind === "hook").map(([name]) => pathOf(name));

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
    const root = files.root as AbsolutePath;
    adapter = await pack.open(root, realpathSync(dir) as AbsolutePath, { hooks });
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
    const stage: Stage = {
      files,
      dir,
      adapter: opened,
      modules,
      tests,
      pathOf,
      ref,
      fullName: pack.fullName,
      cut: pack.cut ?? "stop",
      write,
      say,
      note: (text) => lines.push(`note ${text}`),
    };
    let last: Last = null;
    for (const [at, step] of scenario.steps.entries()) last = await playStep(stage, at, step, last);
  } catch (error) {
    caught(`threw: ${errorText(error)}`);
  } finally {
    try {
      await adapter?.close();
    } catch (error) {
      caught(`close threw: ${errorText(error)}`);
    }
    files.cleanup();
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
