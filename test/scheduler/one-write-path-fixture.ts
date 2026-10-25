import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ObservedInputs } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import type { CatchUpRepo, CatchUpSide } from "./catch-up-fixture.js";

/*
 * Spec 016 D4: the core's one write path for observed paths, over the
 * catch-up fixture's runner, whose runs here report what node:test and
 * pytest report after D4: module loads per completed file in `observed`
 * (with `written` and `direct`), start-up paths per project in
 * `environmentObserved`, and `observedLoads` in each environment.
 */

/** What each run of the side's runner reports beyond its results. */
export interface Observing {
  /** Per test path: what each completed run of it observed. */
  readonly observed?: Readonly<Record<string, Omit<ObservedInputs, "testFile">>>;
  /** Per project: the start-up paths each run loaded. */
  readonly startup?: Readonly<Record<string, readonly string[]>>;
  /** The environments say their observed paths are module loads (016 D4, O8). */
  readonly loads?: boolean;
}

/** Makes `side`'s runner report `observing`; before the side starts. */
export function observing(side: CatchUpSide, what: Observing): void {
  const { runner } = side;
  const run = runner.run.bind(runner);
  runner.run = async (files, options) => {
    const report = await run(files, options);
    const observed = report.completedFiles.flatMap((testFile) => {
      const seen = what.observed?.[testFile.path];
      return seen === undefined ? [] : [{ testFile, ...seen }];
    });
    const startup = Object.entries(what.startup ?? {}).map(([project, paths]) => ({
      project,
      paths,
    }));
    return {
      ...report,
      ...(observed.length > 0 ? { observed } : {}),
      ...(startup.length > 0 && report.completedFiles.length > 0
        ? { environmentObserved: startup }
        : {}),
    };
  };
  const environment = runner.environment;
  runner.environment = async () =>
    (await environment()).map((e) => (what.loads === true ? { ...e, observedLoads: true } : e));
}

/** Commits a `.gitignore` of `ignored` in `repo`, and writes each of `files` git then ignores. */
export function ignoring(
  repo: CatchUpRepo,
  ignored: readonly string[],
  files: Readonly<Record<string, string>> = {},
): void {
  writeFileSync(join(repo.main, ".gitignore"), `${ignored.join("\n")}\n`);
  git(repo.main, ["add", ".gitignore"]);
  git(repo.main, ["commit", "-qm", "ignore"]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo.main, path)), { recursive: true });
    writeFileSync(join(repo.main, path), text);
  }
}
