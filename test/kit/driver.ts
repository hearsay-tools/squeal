import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type {
  AbsolutePath,
  CancelCause,
  RunnerAdapter,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { FixtureFiles } from "./files.js";
import { isTest, type Module, type Scenario, type Written } from "./scenarios/index.js";
import { type Last, playStep, type Stage } from "./steps.js";
import { type Gap, type Played, verdictOf } from "./verdicts.js";
import { initRepository, OpenWorktree } from "./worktrees.js";

export {
  accepted,
  describePlayed,
  type Gap,
  type Played,
  type Verdict,
  verdictOf,
} from "./verdicts.js";

/*
 * Spec 016 D1: the kit's driver. It writes a scenario's fixture with a
 * pack, then drives the pack's adapter through `RunnerAdapter` alone: list,
 * run, edit, `invalidate` or `recheck`, `affected`, `closure`, run again,
 * and cut a run with its signals. It starts no daemon. A play's worktrees
 * share one scratch store, and what each run observed reaches it by the
 * path its runner takes today (`worktrees.ts`), so it checks outcomes and
 * reach, in a second worktree and after a restart too; transitions are the
 * core's. It names no runner: everything a runner knows is its pack.
 */

/** What the pack opens over, beyond the files it wrote. */
export interface Fixture {
  /** The paths of the scenario's `hook` modules: the runner loads each before every test file. */
  readonly hooks: readonly string[];
  /**
   * The worktree's connection to the play's one store, for an adapter that
   * writes what it observed there itself, as a daemon injects one.
   */
  readonly store: Store;
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
  /**
   * Opens the adapter over the written fixture; `scratch` is the
   * worktree's own directory outside it, kept across a restart.
   */
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

const errorText = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** One worktree of a play: its files, and while open its adapter, keys and store connection. */
interface Tree {
  readonly name: string;
  /** Its directory outside the files, the pack's `scratch`. */
  readonly home: AbsolutePath;
  readonly files: FixtureFiles;
  readonly write: (name: string, module: Written) => void;
  opened: OpenWorktree | null;
}

/**
 * Plays `scenario` through `pack` in a fresh directory under `scratch`:
 * worktree `a`, and each worktree a step names, all over one store.
 */
export async function play(scenario: Scenario, pack: Pack, scratch: string): Promise<Played> {
  const dir = join(scratch, `${scenario.name}-${pack.name.replace(/\W+/g, "-")}`);
  mkdirSync(join(dir, "common"), { recursive: true });
  const common = realpathSync(join(dir, "common")) as AbsolutePath;
  const modules = new Map(Object.entries(scenario.modules));
  const pathOf = (name: string) => pack.path(name, of(name));
  function of(name: string): Module {
    const module = modules.get(name);
    if (module === undefined) throw new Error(`${scenario.name} has no module ${name}`);
    return module;
  }
  const tests = [...modules].filter(([, m]) => isTest(m)).map(([name]) => name);
  const hooks = [...modules].filter(([, m]) => m.kind === "hook").map(([name]) => pathOf(name));
  const trees = new Map<string, Tree>();
  /** Writes worktree `name`: the pack's project files and the scenario's modules, as first written. */
  const plant = (name: string): Tree => {
    mkdirSync(join(dir, name, "worktree"), { recursive: true });
    const files = new FixtureFiles(realpathSync(join(dir, name, "worktree")));
    /** What an install wrote beside each module, so the next one removes what it no longer lists. */
    const besides = new Map<string, readonly string[]>();
    const write = (module: string, written: Written) => {
      files.put(pathOf(module), pack.text(written, of));
      const beside = pack.beside?.(module, written) ?? {};
      for (const path of besides.get(module) ?? []) if (!(path in beside)) files.remove(path);
      for (const [path, text] of Object.entries(beside)) files.put(path, text);
      besides.set(module, Object.keys(beside));
    };
    for (const [path, text] of Object.entries(pack.project)) files.put(path, text);
    for (const [module, written] of modules) if (written.kind !== "absent") write(module, written);
    initRepository(files.root);
    const home = realpathSync(join(dir, name)) as AbsolutePath;
    const tree: Tree = { name, home, files, write, opened: null };
    trees.set(name, tree);
    return tree;
  };

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
  /** Opens `tree` over the store, and asserts its adapter lists every test module. */
  const open = async (tree: Tree, at: string): Promise<OpenWorktree> => {
    const root = tree.files.root as AbsolutePath;
    const opened = await OpenWorktree.open(tree.name, root, common, (store) =>
      pack.open(root, tree.home, { hooks, store }),
    );
    tree.opened = opened;
    const listed = await opened.adapter.testFiles();
    say(
      tests.every((t) => listed.some((f) => f.path === pathOf(t))),
      `${at}lists ${tests.map(pathOf).join(", ")} (got ${listed.map((f) => f.path).join(", ")})`,
    );
    return opened;
  };
  try {
    let tree = plant("a");
    const listed = await (await open(tree, "")).adapter.testFiles();
    const ref = (name: string): TestFileRef => {
      const found = listed.find((f) => f.path === pathOf(name));
      if (found === undefined) throw new Error(`${pathOf(name)} is not listed`);
      return found;
    };
    const stageOf = (current: Tree): Stage => {
      const opened = current.opened;
      if (opened === null) throw new Error(`worktree ${current.name} is not open`);
      return {
        files: current.files,
        dir,
        adapter: opened.adapter,
        modules,
        tests,
        pathOf,
        ref,
        fullName: pack.fullName,
        cut: pack.cut ?? "stop",
        write: current.write,
        keyed: (file) => opened.keyed(file),
        record: (files, run) => opened.record(files, run),
        say,
        note: (text) => lines.push(`note ${text}`),
      };
    };
    let stage = stageOf(tree);
    let last: Last = null;
    for (const [at, step] of scenario.steps.entries()) {
      if ("worktree" in step || "restart" in step) {
        if ("worktree" in step) {
          tree = trees.get(step.worktree) ?? plant(step.worktree);
          if (tree.opened === null) await open(tree, `step ${at} in ${tree.name}: `);
        } else {
          const closing = tree.opened;
          tree.opened = null;
          await closing?.close();
          await open(tree, `step ${at} restarted ${tree.name}: `);
        }
        stage = stageOf(tree);
        // What the adapter saw of a run in another worktree, or before a restart, is no reach.
        last = null;
        continue;
      }
      last = await playStep(stage, at, step, last);
    }
  } catch (error) {
    caught(`threw: ${errorText(error)}`);
  } finally {
    for (const tree of trees.values()) {
      try {
        await tree.opened?.close();
      } catch (error) {
        caught(`close threw: ${errorText(error)}`);
      }
      tree.files.cleanup();
    }
  }
  const gap = pack.known?.[scenario.name];
  const verdict = verdictOf(failed, errored, gap);
  return { scenario: scenario.name, pack: pack.name, verdict, known: gap?.spec, lines };
}
