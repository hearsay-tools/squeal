import { describe, expect, it } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import type {
  AffectedTestFiles,
  CheckRunResult,
  InvalidatedPath,
  RunnerAdapter,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";

/*
 * Spec 003 D7: "The daemon holds one `RunnerAdapter` per configured or
 * detected runner behind a composite in `src/core/daemon/`: `testFiles()`
 * and `environment()` concatenate, `affected()` and `invalidate()` fan out
 * and merge, `run()` dispatches by project, `close()` closes each."
 */

const OPTIONS: RunOptions = { runId: "r1", logDir: "/tmp/squeal-runs/r1", timeoutMs: 1000 };

const ref = (project: string, path: string): TestFileRef => ({ project, path });

function passed(file: TestFileRef): CheckRunResult {
  return {
    check: { kind: "test", project: file.project, testPath: file.path, fullName: "works" },
    outcome: "pass",
    durationMs: 1,
    location: null,
    errors: [],
  };
}

interface Fake extends RunnerAdapter {
  readonly calls: string[];
}

/** An adapter over fixed test files, one project per entry of `files`. */
function fake(
  name: string,
  files: Readonly<Record<string, readonly string[]>>,
  overrides: {
    affected?: AffectedTestFiles;
    recreated?: readonly string[];
    run?: (testFiles: readonly TestFileRef[]) => Promise<RunReport>;
    close?: () => Promise<void>;
  } = {},
): Fake {
  const calls: string[] = [];
  const refs = Object.entries(files).flatMap(([project, paths]) =>
    paths.map((path) => ref(project, path)),
  );
  return {
    name,
    adapterVersion: `${name}-1`,
    calls,
    invalidate: async (paths: readonly InvalidatedPath[]) => {
      calls.push(`invalidate ${paths.map((p) => p.path).join(",")}`);
      return { recreatedProjects: overrides.recreated ?? [] };
    },
    affected: async (changed) => {
      calls.push(`affected ${changed.join(",")}`);
      return overrides.affected ?? { direct: [], transitive: [] };
    },
    closure: async (testFile) => {
      calls.push(`closure ${testFile.path}`);
      return { testFile, paths: [testFile.path, `${name}-lib.ts`] };
    },
    enumerate: async (testFile) => {
      calls.push(`enumerate ${testFile.path}`);
      return [{ check: passed(testFile).check, templated: false, location: null }];
    },
    testFiles: async () => {
      calls.push("testFiles");
      return refs;
    },
    environment: async () => {
      calls.push("environment");
      return Object.keys(files).map((project) => ({
        project,
        runnerName: name,
        runnerVersion: "1.0.0",
        adapterVersion: `${name}-1`,
        resolvedConfig: "{}",
        files: [],
      }));
    },
    run: async (testFiles, options) => {
      calls.push(`run ${testFiles.map((f) => f.path).join(",")} ${options.runId}`);
      if (overrides.run !== undefined) return overrides.run(testFiles);
      return {
        end: "completed",
        durationMs: 10,
        completedFiles: testFiles,
        results: testFiles.map(passed),
        fileErrors: [],
        failure: null,
        fileDurations: testFiles.map((testFile) => ({ testFile, durationMs: 5 })),
      };
    },
    close: async () => {
      calls.push("close");
      await overrides.close?.();
    },
  };
}

function pair(overrides: Parameters<typeof fake>[2] = {}) {
  const vitest = fake("vitest", { "": ["src/a.test.ts", "src/b.test.ts"] });
  const node = fake("node-test", { "test:unit": ["test/unit/c.test.ts"] }, overrides);
  return { vitest, node, composite: createCompositeRunner([vitest, node]) };
}

const A = ref("", "src/a.test.ts");
const B = ref("", "src/b.test.ts");
const C = ref("test:unit", "test/unit/c.test.ts");

describe("createCompositeRunner (spec 003 D7)", () => {
  it("names itself after its adapters", () => {
    const { composite } = pair();
    expect(composite.name).toBe("vitest+node-test");
    expect(composite.adapterVersion).toBe("vitest-1+node-test-1");
  });

  it("concatenates testFiles and environment", async () => {
    const { composite } = pair();
    expect(await composite.testFiles()).toEqual([A, B, C]);
    expect((await composite.environment()).map((e) => [e.project, e.runnerName])).toEqual([
      ["", "vitest"],
      ["test:unit", "node-test"],
    ]);
  });

  it("fans out invalidate and merges the recreated projects", async () => {
    const vitest = fake("vitest", { "": [] }, { recreated: [""] });
    const node = fake(
      "node-test",
      { "test:unit": [], "test:package": [] },
      { recreated: ["test:unit", "test:package"] },
    );
    const composite = createCompositeRunner([vitest, node]);
    const changed: InvalidatedPath[] = [{ path: "squeal.config.json", kind: "change" }];
    expect(await composite.invalidate(changed)).toEqual({
      recreatedProjects: ["", "test:package", "test:unit"],
    });
    expect(vitest.calls).toEqual(["invalidate squeal.config.json"]);
    expect(node.calls).toEqual(["invalidate squeal.config.json"]);
  });

  it("fans out affected and merges direct and transitive, sorted", async () => {
    const D = ref("test:unit", "test/unit/d.test.ts");
    const vitest = fake("vitest", { "": [] }, { affected: { direct: [B], transitive: [A] } });
    const node = fake("node-test", { "test:unit": [] }, { affected: { direct: [C], transitive: [D] } });
    const composite = createCompositeRunner([node, vitest]);
    expect(await composite.affected(["src/lib.ts"])).toEqual({ direct: [B, C], transitive: [A, D] });
    expect(vitest.calls).toEqual(["affected src/lib.ts"]);
    expect(node.calls).toEqual(["affected src/lib.ts"]);
  });

  it("asks the adapter of a file's project for its closure and checks", async () => {
    const { vitest, node, composite } = pair();
    await composite.testFiles();
    expect((await composite.closure(C)).paths).toEqual(["test/unit/c.test.ts", "node-test-lib.ts"]);
    expect((await composite.enumerate(A))[0]?.check.testPath).toBe("src/a.test.ts");
    expect(node.calls).toEqual(["testFiles", "closure test/unit/c.test.ts"]);
    expect(vitest.calls).toEqual(["testFiles", "enumerate src/a.test.ts"]);
  });

  it("learns a project's adapter from environment when testFiles was not called", async () => {
    const { node, composite } = pair();
    await composite.closure(C);
    expect(node.calls).toEqual(["environment", "closure test/unit/c.test.ts"]);
  });

  it("rejects a file of a project no adapter owns", async () => {
    const { composite } = pair();
    await expect(composite.closure(ref("e2e", "test/e2e/x.test.ts"))).rejects.toThrow(
      /no runner owns project "e2e" \(test\/e2e\/x\.test\.ts\)/,
    );
  });

  it("rejects a project two adapters report", async () => {
    const composite = createCompositeRunner([
      fake("vitest", { unit: ["a.test.ts"] }),
      fake("node-test", { unit: ["b.test.ts"] }),
    ]);
    await expect(composite.testFiles()).rejects.toThrow(
      /project "unit" is reported by both vitest and node-test/,
    );
  });

  it("dispatches a run spanning both adapters by project and merges the reports", async () => {
    const { vitest, node, composite } = pair();
    await composite.testFiles();
    const report = await composite.run([C, A, B], OPTIONS);
    expect(vitest.calls.at(-1)).toBe("run src/a.test.ts,src/b.test.ts r1");
    expect(node.calls.at(-1)).toBe("run test/unit/c.test.ts r1");
    expect(report).toEqual({
      end: "completed",
      durationMs: 20,
      completedFiles: [A, B, C],
      results: [A, B, C].map(passed),
      fileErrors: [],
      failure: null,
      fileDurations: [A, B, C].map((testFile) => ({ testFile, durationMs: 5 })),
    });
  });

  it("runs only the adapters a run's files belong to", async () => {
    const { vitest, node, composite } = pair();
    await composite.testFiles();
    await composite.run([A], OPTIONS);
    expect(vitest.calls.at(-1)).toBe("run src/a.test.ts r1");
    expect(node.calls).toEqual(["testFiles"]);
  });

  it("keeps the other adapter's results when one adapter's run crashed", async () => {
    const { composite } = pair({
      run: async () => ({
        end: "crashed",
        durationMs: 3,
        completedFiles: [],
        results: [],
        fileErrors: [],
        failure: "node exited with signal SIGSEGV before any file completed",
      }),
    });
    await composite.testFiles();
    const report = await composite.run([A, C], OPTIONS);
    expect(report.end).toBe("crashed");
    expect(report.durationMs).toBe(13);
    expect(report.completedFiles).toEqual([A]);
    expect(report.results).toEqual([passed(A)]);
    expect(report.fileDurations).toEqual([{ testFile: A, durationMs: 5 }]);
    expect(report.failure).toBe("node-test: node exited with signal SIGSEGV before any file completed");
  });

  it("turns an adapter whose run rejects into a crashed part of the run", async () => {
    const { composite } = pair({ run: () => Promise.reject(new Error("spawn node ENOENT")) });
    await composite.testFiles();
    const report = await composite.run([A, C], OPTIONS);
    expect(report.end).toBe("crashed");
    expect(report.completedFiles).toEqual([A]);
    expect(report.failure).toBe("node-test: spawn node ENOENT");
  });

  it("is timed-out when one part timed out and none crashed", async () => {
    const { composite } = pair({
      run: async () => ({
        end: "timed-out",
        durationMs: 1000,
        completedFiles: [],
        results: [],
        fileErrors: [],
        failure: "run exceeded 1000 ms",
      }),
    });
    await composite.testFiles();
    const report = await composite.run([A, C], OPTIONS);
    expect(report.end).toBe("timed-out");
    expect(report.failure).toBe("node-test: run exceeded 1000 ms");
  });

  it("closes each adapter even when one fails to close, then rejects", async () => {
    const vitest = fake("vitest", {}, { close: () => Promise.reject(new Error("busy")) });
    const node = fake("node-test", {});
    await expect(createCompositeRunner([vitest, node]).close()).rejects.toThrow(/busy/);
    expect(vitest.calls).toEqual(["close"]);
    expect(node.calls).toEqual(["close"]);
  });
});
