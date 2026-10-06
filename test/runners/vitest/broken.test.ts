import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SerializedError } from "vitest/node";
import { VitestAdapter } from "../../../src/runners/vitest/adapter.js";
import { isRunnerFailure } from "../../../src/runners/vitest/broken.js";
import { loadVitest, type VitestNode } from "../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import {
  ALL_TEST_FILES,
  addWorktree,
  createRepo,
  openHarness,
  openRepoStore,
} from "../../scheduler/helpers.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Lessons, defect 12: an error the runner's own module loading raises is a
 * runner failure (spec 001 D5), never a `fail` stored under a key that every
 * worktree with that key inherits.
 */

const scratch = resolve(import.meta.dirname, "../../fixtures/vitest/.tmp");

/**
 * A temp directory outside every fixture root: Vitest takes `os.tmpdir()`
 * when an instance starts, so `open` runs with `TMPDIR` pointing at it.
 */
async function withTempDir<T>(open: () => Promise<T>): Promise<{ value: T; tmp: string }> {
  const tmp = join(scratch, `tmpdir-${crypto.randomUUID()}`);
  mkdirSync(tmp, { recursive: true });
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    return { value: await open(), tmp };
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
}

describe("isRunnerFailure", () => {
  const root = "/w";
  const files = { paths: new WorktreePaths(root), tempDirs: ["/w/.ai/tmp/abc"] };
  const runnerFrame =
    "    at reviveInvokeError (file:///w/node_modules/vite/dist/node/module-runner.js:555:14)";
  const error = (message: string, ...frames: string[]): SerializedError =>
    ({
      name: "Error",
      message,
      stack: [`Error: ${message}`, ...frames].join("\n"),
    }) as SerializedError;

  it("an ENOENT under the instance's temp directory, even inside the worktree", () => {
    const e = error(
      "ENOENT: no such file or directory, open '/w/.ai/tmp/abc/ssr/0a1b'",
      runnerFrame,
    );
    expect(isRunnerFailure(e, files)).toBe(true);
    const { stack: _, ...bare } = e;
    expect(isRunnerFailure(bare, files)).toBe(true);
  });

  it("a loader error naming only installed files, as during npm ci", () => {
    const e = error(
      "ENOENT: no such file or directory, open '/w/node_modules/chai/index.js'",
      runnerFrame,
    );
    expect(isRunnerFailure(e, files)).toBe(true);
  });

  it("not a loader error that names a project file", () => {
    const e = error(
      "Cannot find package 'x' imported from /w/test/a.test.ts",
      runnerFrame,
      "    at /w/test/a.test.ts:1:1",
    );
    expect(isRunnerFailure(e, files)).toBe(false);
  });

  it("not an error a dependency throws while imported, nor one without a stack", () => {
    const thrown = error(
      "bad config",
      "    at file:///w/node_modules/dep/index.js:3:9",
      runnerFrame,
    );
    expect(isRunnerFailure(thrown, files)).toBe(false);
    expect(isRunnerFailure({ name: "Error", message: "x" } as SerializedError, files)).toBe(false);
  });
});

describe("vitest adapter: a broken runner environment", SLOW, () => {
  it("a temp directory removed under a live instance is a crash, then the recreated instance passes", async () => {
    const { value: fx, tmp } = await withTempDir(() => openFixture());
    const files = [ref("test/math.test.ts"), ref("test/strings.test.ts")];
    const first = await fx.adapter.run(files, fx.runOptions());
    expect(first.results.map((r) => r.outcome)).toEqual(["pass", "pass", "pass", "pass"]);

    rmSync(tmp, { recursive: true, force: true });
    const broken = await fx.adapter.run(files, fx.runOptions());
    expect(broken.end).toBe("crashed");
    expect(broken.completedFiles).toEqual([]);
    expect(broken.results).toEqual([]);
    expect(broken.failure).toMatch(
      /^the Vitest instance failed to load modules and is recreated: Error: ENOENT/,
    );

    const after = await fx.adapter.run(files, fx.runOptions());
    expect(after.end).toBe("completed");
    expect(after.completedFiles).toEqual(files);
    expect(after.results.map((r) => r.outcome)).toEqual(["pass", "pass", "pass", "pass"]);
  });

  it("a test file's own import, package and syntax errors still complete as file-level failures", async () => {
    const fx = await openFixture("basic", {
      "test/missing.test.ts":
        'import { x } from "../src/nope.ts";\nimport { it } from "vitest";\nit("x", () => x);\n',
      "test/pkg.test.ts":
        'import { x } from "no-such-pkg";\nimport { it } from "vitest";\nit("x", () => x);\n',
      "test/syntax.test.ts": 'import { it } from "vitest";\nit("x", () => { (;\n',
      "test/throws.test.ts":
        'import "../src/throws.ts";\nimport { it } from "vitest";\nit("x", () => {});\n',
      "src/throws.ts": 'throw new Error("boom at import");\n',
    });
    const files = ["missing", "pkg", "syntax", "throws"].map((n) => ref(`test/${n}.test.ts`));
    // Twice: the second run serves every module from the instance's temp copies.
    for (const _ of [1, 2]) {
      const report = await fx.adapter.run(files, fx.runOptions());
      expect(report.end).toBe("completed");
      expect(report.completedFiles).toEqual(files);
      expect(report.fileErrors.map((e) => e.testFile)).toEqual(files);
      expect(report.fileErrors.map((e) => e.errors[0]?.message.split("\n")[0])).toEqual([
        "Cannot find module '../src/nope.ts' imported from test/missing.test.ts",
        "Cannot find package 'no-such-pkg' imported from test/pkg.test.ts",
        "Transform failed with 1 error:",
        "boom at import",
      ]);
    }
  });

  it("an install into a worktree with no node_modules recreates the instance from its own vitest/node", async () => {
    const fx = await openFixture();
    let started = 0;
    const real = await loadVitest(realpathSync(fx.root));
    const node = {
      ...real,
      createVitest: (...args: Parameters<VitestNode["createVitest"]>) => {
        started++;
        return real.createVitest(...args);
      },
    } as VitestNode;
    const adapter = new VitestAdapter(new WorktreePaths(realpathSync(fx.root)), node);
    await adapter.open();
    try {
      expect(started).toBe(1);
      // A plain node_modules file is no trigger.
      fx.write("node_modules/left-pad/index.js", "export {};\n");
      const plain = await adapter.invalidate([
        { path: "node_modules/left-pad/index.js", kind: "add" },
      ]);
      expect(plain.recreatedProjects).toEqual([]);

      fx.write("node_modules/.package-lock.json", '{ "lockfileVersion": 3 }\n');
      const installed = await adapter.invalidate([
        { path: "node_modules/.package-lock.json", kind: "add" },
      ]);
      expect(installed.recreatedProjects).toEqual([""]);
      // The new instance comes from `vitest/node` imported again, not the one it started with.
      expect(started).toBe(1);
      const report = await adapter.run([ref("test/math.test.ts")], fx.runOptions());
      expect(report.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);

      // A change to the lockfile the instance started with recreates it again.
      fx.write("node_modules/.package-lock.json", '{ "lockfileVersion": 3, "x": 1 }\n');
      const changed = await adapter.invalidate([
        { path: "node_modules/.package-lock.json", kind: "change" },
      ]);
      expect(changed.recreatedProjects).toEqual([""]);
    } finally {
      await adapter.close();
    }
  });
});

describe("a broken runner environment in the shared store", SLOW, () => {
  it("stores nothing, so a second worktree with the same keys inherits nothing from it", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const { value: a, tmp } = await withTempDir(() =>
      openHarness(repo.main, store, repo.commonDir),
    );
    await a.scheduler.start();
    await a.scheduler.idle();
    const baseline = new Set(a.runner.runs.map((r) => r.options.runId));

    rmSync(tmp, { recursive: true, force: true });
    await a.scheduler.requestFullSuite({ force: true });
    await a.scheduler.idle();
    const broken = a.runner.runs.filter((r) => !baseline.has(r.options.runId));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken[0]?.report.end).toBe("crashed");
    const crashed = new Set(
      broken.filter((r) => r.report.end === "crashed").map((r) => r.options.runId),
    );
    expect(a.scheduler.status().testFiles.unknown).toBeGreaterThan(0);

    const keys = ALL_TEST_FILES.map((path) => a.keyOf(path));
    const stored = keys.flatMap((key) => store.results.byKey(key));
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.filter((r) => r.outcome === "fail")).toEqual([]);
    expect(stored.filter((r) => crashed.has(r.provenance.runId ?? ""))).toEqual([]);

    const root = addWorktree(repo.main, repo.dir, "second");
    const b = await openHarness(root, store, repo.commonDir);
    await b.scheduler.start();
    await b.scheduler.idle();
    const applied = b.sink.callsOf("applyResults").flatMap((c) => c.results);
    expect(applied.filter((r) => r.outcome === "fail")).toEqual([]);
    expect(applied.filter((r) => crashed.has(r.provenance.runId ?? ""))).toEqual([]);

    // The recreated instance runs the suite again and passes.
    await a.scheduler.requestFullSuite({ force: true });
    await a.scheduler.idle();
    const last = a.runner.runs.at(-1)?.report;
    expect(last?.end).toBe("completed");
    expect(a.scheduler.status().testFiles.unknown).toBe(0);
  });
});
