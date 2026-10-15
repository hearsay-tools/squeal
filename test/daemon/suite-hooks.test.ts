import { describe, expect, it, vi } from "vitest";
import { type BuiltCli, daemonSuite } from "./helpers.js";

/*
 * Task 001-385: under a loaded full suite the daemon suite's `beforeAll`
 * (`tsc`) and `afterAll` (removing the build) each outlasted the 10 s hook
 * default, and a suite-level hook error fails the whole file (001-360). Here
 * the default drops to 100 ms before the suite registers its hooks, and the
 * build and its cleanup each block for 300 ms. Were either hook left at the
 * default, this file would fail with "Hook timed out in 100ms".
 */

const BLOCK_MS = 300;

/** Blocks the thread, as `execFileSync` and `rmSync` do. */
function block(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const removed: string[] = [];
function slowBuild(): BuiltCli {
  block(BLOCK_MS);
  return {
    cli: "/nonexistent/squeal",
    cleanup: () => {
      block(BLOCK_MS);
      removed.push("built");
    },
  };
}

vi.setConfig({ hookTimeout: 100 });

describe("daemonSuite: a slow build and a slow cleanup (task 001-385)", () => {
  const suite = daemonSuite({}, slowBuild);

  it("builds past the hook default and serves the build", () => {
    expect(suite.cli).toBe("/nonexistent/squeal");
    expect(removed).toEqual([]);
  });
});
