import { describe, expect, it } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { afterEachRun, type RunSweeper } from "../../src/core/daemon/escaped.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import type { RunnerAdapter, TestFileRef } from "../../src/core/types/index.js";

/*
 * Review 001-394 B2: the slow tier asks the daemon's runner how many of its
 * files one slow run starts at once (spec 004 D2). The answer comes from the
 * fast instance, since the slow one exists only once a slow run asked for it,
 * and the composite asks only the first file's adapter, about its own files:
 * its parts run one after another.
 */

const ref = (project: string, path: string): TestFileRef => ({ project, path });

/** An adapter owning `projects` that starts `width` files of a slow run at once, when given. */
function adapter(name: string, projects: readonly string[], width?: number): RunnerAdapter {
  const unused = () => Promise.reject(new Error(`${name}: not called`));
  return {
    name,
    adapterVersion: `${name}-1`,
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: unused,
    closure: unused,
    enumerate: unused,
    testFiles: async () => [],
    environment: async () =>
      projects.map((project) => ({
        project,
        runnerName: name,
        runnerVersion: "1.0.0",
        adapterVersion: `${name}-1`,
        resolvedConfig: "{}",
        files: [],
      })),
    run: unused,
    close: async () => {},
    ...(width === undefined
      ? {}
      : { slowWidth: (files: readonly TestFileRef[]) => Math.min(width, files.length) }),
  };
}

describe("the daemon's runner reports the slow width (review 001-394 B2)", () => {
  it("reaches the fast instance before any slow instance exists", () => {
    const slow = () => {
      throw new Error("no slow instance for a width");
    };
    const runner = withSlowInstance(adapter("vitest", [""], 2), slow);
    const files = [ref("", "a.test.ts"), ref("", "b.test.ts"), ref("", "c.test.ts")];
    expect(runner.slowWidth?.(files)).toBe(2);
    const swept = afterEachRun(runner, {} as RunSweeper, () => {});
    expect(swept.slowWidth?.(files)).toBe(2);
  });

  it("asks the first file's adapter about its own files only", async () => {
    const composite = createCompositeRunner([
      adapter("vitest", ["", "b"], 4),
      adapter("node-test", ["unit"]),
    ]);
    await composite.environment();
    const a = ref("", "a.test.ts");
    const b = ref("b", "b.test.ts");
    const unit = ref("unit", "u.test.ts");
    expect(composite.slowWidth?.([a, b, a])).toBe(3);
    expect(composite.slowWidth?.([a, unit, b])).toBe(1);
    // An adapter that reports none starts all of its own.
    expect(composite.slowWidth?.([unit, unit, a])).toBe(2);
  });
});
