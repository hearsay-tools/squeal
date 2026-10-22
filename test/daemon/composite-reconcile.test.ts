import { describe, expect, it } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { createRunnerSet } from "../../src/core/daemon/runner-set.js";
import type {
  CheckRunResult,
  RunnerAdapter,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";

/*
 * Row 011-78 (011 C10, *Projects at a reload*; `tasks/011-62/design.md` R1):
 * the composite reads its members live, and before `invalidate` fans out it
 * reconciles its project sets with the configuration. A removed project's
 * runner leaves, its part in flight stops and reports nothing; an added one
 * joins; a changed one is replaced and its part in flight finishes. Every
 * such project is reported recreated, so the scheduler lists again.
 */

const OPTIONS: RunOptions = { runId: "r1", logDir: "/tmp/squeal-runs/r1", timeoutMs: 1000 };

interface Entry {
  readonly name: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}

interface Built extends RunnerAdapter {
  readonly entry: Entry;
  readonly calls: string[];
}

function passed(file: TestFileRef): CheckRunResult {
  return {
    check: { kind: "test", project: file.project, testPath: file.path, fullName: "works" },
    outcome: "pass",
    durationMs: 1,
    location: null,
    errors: [],
  };
}

/** A node:test-like runner of one entry: one test file, `<cwd>/a.test.mjs`. */
function build(entry: Entry, run?: Hold): Built {
  const calls: string[] = [];
  const file = { project: entry.name, path: `${entry.cwd}/a.test.mjs` };
  return {
    entry,
    calls,
    name: "node-test",
    adapterVersion: "nt-1",
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: [testFile.path] }),
    enumerate: async () => [],
    testFiles: async () => [file],
    environment: async () => [
      {
        project: entry.name,
        runnerName: "node-test",
        runnerVersion: "1",
        adapterVersion: "nt-1",
        resolvedConfig: "{}",
        files: [],
      },
    ],
    async run(testFiles, options): Promise<RunReport> {
      calls.push(`run ${testFiles.map((f) => f.path).join(",")}`);
      await run?.(entry, options);
      const stopped = options.stop?.aborted === true;
      if (stopped) calls.push("stopped");
      const completed = stopped ? [] : testFiles;
      return {
        end: "completed",
        durationMs: 1,
        completedFiles: completed,
        results: completed.map(passed),
        fileErrors: [],
        failure: null,
      };
    },
    close: async () => {
      calls.push("close");
    },
  };
}

/** What a runner's part waits for before it reports. */
type Hold = (entry: Entry, options: RunOptions) => Promise<void>;

const KEEP: Entry = { name: "keep", cwd: "keep" };
const GONE: Entry = { name: "gone", cwd: "gone" };

/** A set over `entries()`, every runner it built in `built`. */
function setOf(entries: () => readonly Entry[], run?: Hold) {
  const built: Built[] = [];
  const set = createRunnerSet(entries, (entry: Entry) => {
    const runner = build(entry, run);
    built.push(runner);
    return runner;
  });
  return { set, built, of: (name: string) => built.filter((r) => r.entry.name === name) };
}

describe("createCompositeRunner with a reconciling set (row 011-78)", () => {
  it("omits a removed project from the listing and reports it recreated", async () => {
    let entries: readonly Entry[] = [KEEP, GONE];
    const { set, of } = setOf(() => entries);
    const composite = createCompositeRunner([], [set]);
    expect((await composite.testFiles()).map((f) => f.project)).toEqual(["keep", "gone"]);

    entries = [KEEP];
    expect(await composite.invalidate([{ path: "squeal.config.json", kind: "change" }])).toEqual({
      recreatedProjects: ["gone"],
    });
    expect(await composite.testFiles()).toEqual([{ project: "keep", path: "keep/a.test.mjs" }]);
    expect(of("gone")[0]?.calls).toEqual(["close"]);
    await expect(composite.closure({ project: "gone", path: "gone/a.test.mjs" })).rejects.toThrow(
      /no runner owns project "gone"/,
    );
  });

  it("adds a project, replaces a changed one and keeps an unchanged runner", async () => {
    let entries: readonly Entry[] = [KEEP, GONE];
    const { set, of } = setOf(() => entries);
    const composite = createCompositeRunner([], [set]);
    await composite.testFiles();

    entries = [KEEP, { ...GONE, env: { MODE: "b" } }, { name: "added", cwd: "added" }];
    expect(await composite.invalidate([])).toEqual({ recreatedProjects: ["added", "gone"] });
    expect((await composite.testFiles()).map((f) => f.path)).toEqual([
      "keep/a.test.mjs",
      "gone/a.test.mjs",
      "added/a.test.mjs",
    ]);
    expect(of("keep")).toHaveLength(1);
    expect(of("gone").map((r) => r.calls)).toEqual([["close"], []]);
    // An entry's keys in another order are the same entry.
    entries = [
      KEEP,
      { env: { MODE: "b" }, cwd: "gone", name: "gone" },
      { name: "added", cwd: "added" },
    ];
    expect(await composite.invalidate([])).toEqual({ recreatedProjects: [] });
  });

  it("reconciles two entries that swap names without the reported-by-both error", async () => {
    let entries: readonly Entry[] = [
      { name: "a", cwd: "one" },
      { name: "b", cwd: "two" },
    ];
    const { set } = setOf(() => entries);
    const composite = createCompositeRunner([], [set]);
    await composite.testFiles();
    await composite.environment();

    entries = [
      { name: "b", cwd: "one" },
      { name: "a", cwd: "two" },
    ];
    expect(await composite.invalidate([])).toEqual({ recreatedProjects: ["a", "b"] });
    expect(await composite.testFiles()).toEqual([
      { project: "b", path: "one/a.test.mjs" },
      { project: "a", path: "two/a.test.mjs" },
    ]);
  });

  it("reconciles a name moved from one set to another", async () => {
    let left: readonly Entry[] = [{ name: "x", cwd: "nt" }];
    let right: readonly Entry[] = [];
    const nt = setOf(() => left);
    const py = setOf(() => right);
    const composite = createCompositeRunner([], [nt.set, py.set]);
    await composite.testFiles();

    left = [];
    right = [{ name: "x", cwd: "py" }];
    expect(await composite.invalidate([])).toEqual({ recreatedProjects: ["x"] });
    expect(await composite.testFiles()).toEqual([{ project: "x", path: "py/a.test.mjs" }]);
  });

  /** A hold on `name`'s parts until a stop, and a promise that one started. */
  function holding(name: string): { hold: Hold; started: Promise<void>; release: () => void } {
    let started!: () => void;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      started: new Promise<void>((resolve) => {
        started = resolve;
      }),
      release,
      hold: async (entry, options) => {
        if (entry.name !== name) return;
        if (options.stop === undefined) throw new Error("no stop signal");
        started();
        const stop = options.stop;
        if (stop.aborted) return;
        await Promise.race([
          released,
          new Promise((resolve) => stop.addEventListener("abort", resolve)),
        ]);
      },
    };
  }

  it("stops a removed project's part in flight, reports none of it and closes its runner after", async () => {
    let entries: readonly Entry[] = [GONE, KEEP];
    const { hold, started } = holding("gone");
    const { set, of } = setOf(() => entries, hold);
    const composite = createCompositeRunner([], [set]);
    const files = await composite.testFiles();

    // The tier holds both projects; the removed one's part runs first and waits for a stop.
    const run = composite.run(files, OPTIONS);
    await started;
    entries = [KEEP];
    await composite.invalidate([]);
    const report = await run;
    expect(of("gone")[0]?.calls).toEqual(["run gone/a.test.mjs", "stopped", "close"]);
    // Nothing of the removed part is reported: its files are withheld, so none is stored.
    expect(report.withheld).toEqual([{ project: "gone", path: "gone/a.test.mjs" }]);
    // The kept project's part of the same tier ran after it and reports as before.
    expect(of("keep")[0]?.calls).toEqual(["run keep/a.test.mjs"]);
    expect(report.completedFiles).toEqual([{ project: "keep", path: "keep/a.test.mjs" }]);
    expect(report.results.map((r) => r.check.project)).toEqual(["keep"]);
  });

  it("skips a removed project's part that had not started", async () => {
    let entries: readonly Entry[] = [KEEP, GONE];
    const { hold, started, release } = holding("keep");
    const { set, of } = setOf(() => entries, hold);
    const composite = createCompositeRunner([], [set]);
    const run = composite.run(await composite.testFiles(), OPTIONS);
    await started;
    entries = [KEEP];
    await composite.invalidate([]);
    expect(of("gone")[0]?.calls).toEqual(["close"]);
    release();
    const report = await run;
    expect(of("gone")[0]?.calls).toEqual(["close"]);
    expect(report.completedFiles).toEqual([{ project: "keep", path: "keep/a.test.mjs" }]);
    expect(report.withheld).toEqual([{ project: "gone", path: "gone/a.test.mjs" }]);
  });

  it("lets a changed project's part in flight finish, then closes its old runner", async () => {
    let entries: readonly Entry[] = [KEEP];
    const { hold, started, release } = holding("keep");
    const { set, of } = setOf(() => entries, hold);
    const composite = createCompositeRunner([], [set]);
    const run = composite.run(await composite.testFiles(), OPTIONS);
    await started;
    entries = [{ ...KEEP, env: { MODE: "b" } }];
    expect(await composite.invalidate([])).toEqual({ recreatedProjects: ["keep"] });
    const [old] = of("keep");
    expect(old?.calls).toEqual(["run keep/a.test.mjs"]);
    release();
    const report = await run;
    expect(old?.calls).toEqual(["run keep/a.test.mjs", "close"]);
    expect(report.completedFiles).toEqual([{ project: "keep", path: "keep/a.test.mjs" }]);
    expect(report.withheld).toBeUndefined();
  });

  it("closes its members, those a reload left included", async () => {
    let entries: readonly Entry[] = [KEEP, GONE];
    const { set, built } = setOf(() => entries);
    const composite = createCompositeRunner([], [set]);
    entries = [KEEP, { name: "added", cwd: "added" }];
    await composite.invalidate([]);
    await composite.close();
    expect(built.map((r) => [r.entry.name, r.calls])).toEqual([
      ["keep", ["close"]],
      ["gone", ["close"]],
      ["added", ["close"]],
    ]);
  });
});
