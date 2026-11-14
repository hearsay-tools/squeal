import { describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { ObservedInputs, RunReport } from "../../../src/core/types/runner.js";
import { type CoverageBatch, loadedLists } from "../../../src/runners/vitest/coverage.js";
import { withLoaded } from "../../../src/runners/vitest/observe.js";

/*
 * Spec 022 D1 and D2 (row 022-03), without Vitest: which batches give a
 * list, and how a list joins the observed inputs.
 */

const ROOT = "/w";
const paths = new WorktreePaths(ROOT);
/** A Vitest instance as `loadedLists` reads one: projects by name and root. */
const vitest = { projects: [{ name: "", config: { root: ROOT } }] } as unknown as Vitest;
const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };

function batch(testFiles: string[], loaded?: string[]): CoverageBatch {
  return {
    coverage: "/tmp/coverage-1.json",
    testFiles,
    environment: "ssr",
    projectName: "",
    ...(loaded === undefined ? {} : { loaded }),
  };
}

describe("loadedLists (022 D1)", () => {
  const all = () => true;

  it("keeps the worktree's files, sorted, without packages or paths outside the root", () => {
    const lists = loadedLists(
      vitest,
      [
        batch(
          ["test/a.test.ts"],
          ["/w/src/z.ts", "/w/test/a.test.ts", "/w/node_modules/dep/index.js", "/elsewhere/x.ts"],
        ),
      ],
      all,
      paths,
    );
    expect(lists).toEqual([{ testFile: A, paths: ["src/z.ts", "test/a.test.ts"] }]);
  });

  it("drops a list without its own test file as lost", () => {
    expect(loadedLists(vitest, [batch(["test/a.test.ts"], ["/w/src/z.ts"])], all, paths)).toEqual(
      [],
    );
  });

  it("drops a batch of several files, one not wanted, and one without a list", () => {
    const batches = [
      batch(["test/a.test.ts", "test/b.test.ts"], ["/w/test/a.test.ts", "/w/test/b.test.ts"]),
      batch(["test/b.test.ts"], ["/w/test/b.test.ts"]),
      batch(["test/a.test.ts"]),
    ];
    const notB = (ref: TestFileRef) => ref.path !== B.path;
    expect(loadedLists(vitest, batches, notB, paths)).toEqual([]);
  });
});

describe("withLoaded (022 D2)", () => {
  const report = (observed?: ObservedInputs[]): RunReport => ({
    end: "completed",
    durationMs: 1,
    completedFiles: [A, B],
    results: [],
    fileErrors: [],
    failure: null,
    ...(observed === undefined ? {} : { observed }),
  });
  const setup = new Set(["test/setup.ts"]);
  const environment = () => setup;
  const lists = [
    { testFile: A, paths: ["src/lazy.ts", "test/a.test.ts", "test/setup.ts"] },
    { testFile: B, paths: ["test/b.test.ts", "test/setup.ts"] },
  ];

  it("joins each list, less the environment's files, to the observed paths and modules", () => {
    const read: ObservedInputs = { testFile: A, paths: ["data/in.txt"], directories: ["data"] };
    const merged = withLoaded(report([read]), lists, environment);
    expect(merged.loaded).toEqual(lists);
    expect(merged.observed).toEqual([
      {
        testFile: A,
        paths: ["data/in.txt", "src/lazy.ts", "test/a.test.ts"],
        modules: ["src/lazy.ts", "test/a.test.ts"],
        directories: ["data"],
      },
      { testFile: B, paths: ["test/b.test.ts"], modules: ["test/b.test.ts"], directories: [] },
    ]);
  });

  it("adds no file whose list the environment holds whole", () => {
    const only = [{ testFile: B, paths: ["test/setup.ts"] }];
    expect(withLoaded(report([]), only, environment).observed).toEqual([]);
  });

  it("joins nothing when the run observed nothing (policy observe.runtimeInputs off)", () => {
    const merged = withLoaded(report(), lists, environment);
    expect(merged.observed).toBeUndefined();
    expect(merged.loaded).toEqual(lists);
  });

  it("leaves a report without lists as it is", () => {
    const plain = report();
    expect(withLoaded(plain, [], environment)).toBe(plain);
  });
});
