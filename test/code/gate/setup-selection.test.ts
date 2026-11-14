import { describe, expect, it } from "vitest";
import { type Picked, summarize } from "../../../src/core/code/gate/prerun.js";
import { setupFilesOf } from "../../../src/core/code/gate/setup-selection.js";
import type { ChangedSet, TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter, RunnerEnvironment } from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";

/*
 * Row 020-57 (#212): before the run, a `setupFiles` entry counts as loaded
 * by its project's selected files, as each completed file's record holds
 * it; a config or global setup file does not, as no record holds it. A
 * changed path in a project's environment files is named with the
 * projects it selects whole. Fake adapters: nothing runs.
 */

const SETUP = "vitest.setup.ts" as RelativePath;
const HELPER = "test/helper.ts" as RelativePath;
const CONFIG = "vitest.config.ts" as RelativePath;
const GLOBAL = "global-setup.ts" as RelativePath;
const SOURCE = "src/a.ts" as RelativePath;

/** A Vitest project's environment, its resolved config naming `setupFiles` as Vitest's canonical one does. */
function environment(project: string, setupFiles: readonly string[]): RunnerEnvironment {
  return {
    project,
    runnerName: "vitest",
    runnerVersion: "5.0.3",
    adapterVersion: "1",
    resolvedConfig: JSON.stringify({ globalSetup: [GLOBAL], root: ".", setupFiles }),
    files: [CONFIG, GLOBAL, ...setupFiles, HELPER].sort() as RelativePath[],
  };
}

/** A pick of `kind` whose test files each load `src/a.ts` and themselves; `run` the files the scope runs. */
function pick(
  listed: readonly TestFileRef[],
  environments: readonly RunnerEnvironment[] | Error,
  run: readonly TestFileRef[] = listed,
): Picked {
  const adapter = {
    traits: NO_TRAITS,
    closure: async (ref: TestFileRef) => ({ testFile: ref, paths: [ref.path, SOURCE] }),
    environment: async () => {
      if (environments instanceof Error) throw environments;
      return environments;
    },
  } as unknown as RunnerAdapter;
  const leftOut = listed
    .filter((ref) => !run.includes(ref))
    .map((ref) => ({ ref, group: "browser" })) as unknown as Picked["leftOut"];
  return { kind: "vitest", adapter, listed, run, leftOut };
}

/** A change to `paths`, one function in each. */
const changed = (paths: readonly RelativePath[]) =>
  ({
    ref: "main",
    paths: [...paths].sort(),
    functions: paths.map((path) => ({ path })),
  }) as unknown as ChangedSet;

const context = {
  scope: undefined,
  leftOut: [],
  known: new Map<TestFileRef, TestFileEvidence>(),
  excluded: () => false,
};

const refs = (project: string, count: number): TestFileRef[] =>
  Array.from({ length: count }, (_, i) => ({ project, path: `test/${project}${i}.test.ts` }));

describe("setupFilesOf", () => {
  it("reads the setupFiles entries of a resolved config, relative to the worktree", () => {
    const config = { setupFiles: [SETUP, "/abs/setup.ts", "../out.ts", "C:/x.ts", 3, ""] };
    expect(setupFilesOf({ resolvedConfig: JSON.stringify(config) })).toEqual([SETUP]);
  });

  it("gives none for another shape, so the no-loader line stays", () => {
    for (const resolvedConfig of ["not json", "null", "[]", "{}", '{"setupFiles":"a.ts"}']) {
      expect(setupFilesOf({ resolvedConfig })).toEqual([]);
    }
  });
});

describe("summarize: a setup file before the run (row 020-57)", () => {
  it("counts a setupFiles entry as loaded and names the project it selects whole", async () => {
    const files = refs("server", 3);
    const summary = await summarize(
      [pick(files, [environment("server", [SETUP])])],
      changed([SETUP, SOURCE]),
      context,
    );
    expect(summary.unloaded).toEqual([]);
    expect(summary.wholeProjects).toEqual([
      {
        runner: "vitest",
        paths: [SETUP],
        setupFiles: [SETUP],
        projects: ["server"],
        files: 3,
        run: 3,
      },
    ]);
  });

  it("keeps the no-loader line for a config and a global setup file, which no record holds", async () => {
    const summary = await summarize(
      [pick(refs("server", 2), [environment("server", [SETUP])])],
      changed([CONFIG, GLOBAL]),
      context,
    );
    expect(summary.unloaded).toEqual([GLOBAL, CONFIG]);
    expect(summary.wholeProjects).toEqual([
      {
        runner: "vitest",
        paths: [GLOBAL, CONFIG],
        setupFiles: [],
        projects: ["server"],
        files: 2,
        run: 2,
      },
    ]);
  });

  it("keeps the no-loader line for a setup file's own import, which it does not read", async () => {
    const summary = await summarize(
      [pick(refs("", 1), [environment("", [SETUP])])],
      changed([HELPER]),
      context,
    );
    expect(summary.unloaded).toEqual([HELPER]);
    expect(summary.wholeProjects?.[0]).toMatchObject({ paths: [HELPER], projects: [""] });
  });

  it("keeps the no-loader line when the scope runs no file of the setup file's project", async () => {
    const files = refs("browser", 2);
    const summary = await summarize(
      [pick(files, [environment("browser", [SETUP])], [])],
      changed([SETUP]),
      context,
    );
    expect(summary.unloaded).toEqual([SETUP]);
    expect(summary.wholeProjects).toBeUndefined();
  });

  it("counts the setup file only for its own project, and the files the stores give apart", async () => {
    const [server, client] = [refs("server", 2), refs("client", 3)];
    const known = new Map([[server[0] as TestFileRef, { from: "store" } as TestFileEvidence]]);
    const summary = await summarize(
      [pick([...server, ...client], [environment("server", [SETUP]), environment("client", [])])],
      changed([SETUP]),
      { ...context, known },
    );
    expect(summary.unloaded).toEqual([]);
    expect(summary.wholeProjects).toEqual([
      {
        runner: "vitest",
        paths: [SETUP],
        setupFiles: [SETUP],
        projects: ["server"],
        files: 2,
        run: 1,
      },
    ]);
  });

  it("changes nothing when the runner gives no environment", async () => {
    const summary = await summarize(
      [pick(refs("server", 2), new Error("no environment"))],
      changed([SETUP]),
      context,
    );
    expect(summary.unloaded).toEqual([SETUP]);
    expect(summary.wholeProjects).toBeUndefined();
  });
});
