import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { afterEachRun, EscapedChildren } from "../../src/core/daemon/escaped.js";
import type { RunnerAdapter, RunReport, TestFileRef } from "../../src/core/types/index.js";
import { isAlive } from "./strays.js";

/*
 * Spec 001 D12 with D5 as amended (task 001-140): runs of two lanes overlap,
 * and the stop after a run must not hit the other run's workers. It waits for
 * the last run in flight and looks back to the first one's mark.
 */

const SLEEPER = ["-e", "setTimeout(() => {}, 600000)"];
const started: ChildProcess[] = [];

afterEach(() => {
  for (const child of started.splice(0)) if (isAlive(child.pid ?? -1)) child.kill("SIGKILL");
});

/** A process carrying the daemon's child mark, as a Vitest worker or what a test starts with its env. */
function carrier(children: EscapedChildren, detached: boolean): ChildProcess {
  const child = spawn(process.execPath, SLEEPER, {
    env: { ...process.env, ...children.env },
    stdio: "ignore",
    detached,
  });
  child.unref();
  started.push(child);
  return child;
}

function completed(testFiles: readonly TestFileRef[]): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: testFiles,
    results: [],
    fileErrors: [],
    failure: null,
  };
}

const LONG: TestFileRef = { project: "", path: "test/long.test.ts" };
const SHORT: TestFileRef = { project: "unit", path: "test/short.test.ts" };

describe.runIf(process.platform === "linux")(
  "afterEachRun with overlapping runs (task 001-140)",
  () => {
    it("stops a short run's escape only when the long run ends, and never the long run's worker", async () => {
      const children = new EscapedChildren();
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let worker: ChildProcess | null = null;
      let leftover: ChildProcess | null = null;
      const inner: RunnerAdapter = {
        name: "vitest+node-test",
        adapterVersion: "1",
        invalidate: async () => ({ recreatedProjects: [] }),
        affected: async () => ({ direct: [], transitive: [] }),
        closure: async (testFile) => ({ testFile, paths: [] }),
        enumerate: async () => [],
        testFiles: async () => [LONG, SHORT],
        environment: async () => [],
        lane: (testFile) => (testFile.project === "" ? "vitest" : "node-test"),
        async run(testFiles) {
          if (testFiles.includes(LONG)) {
            // A worker that lives for the whole run, then exits with it.
            worker = carrier(children, false);
            await held;
            worker.kill("SIGTERM");
          } else {
            leftover = carrier(children, true);
          }
          return completed(testFiles);
        },
        close: async () => {},
      };
      const notes: string[] = [];
      const runner = afterEachRun(inner, children, (text) => notes.push(text));
      expect(runner.lane?.(SHORT)).toBe("node-test");

      const long = runner.run([LONG], { runId: "long", logDir: "/tmp/long", timeoutMs: null });
      await expect.poll(() => worker).not.toBeNull();
      await runner.run([SHORT], { runId: "short", logDir: "/tmp/short", timeoutMs: null });
      const escaped = (leftover as ChildProcess | null)?.pid ?? -1;
      const working = (worker as ChildProcess | null)?.pid ?? -1;
      // The short run settled with the long one in flight: nothing was stopped.
      expect(notes).toEqual([]);
      expect(isAlive(working)).toBe(true);
      expect(isAlive(escaped)).toBe(true);

      release();
      await long;
      await expect.poll(() => isAlive(escaped), { timeout: 10_000 }).toBe(false);
      expect(notes).toEqual([
        expect.stringMatching(
          new RegExp(`^stopped 1 process a test left running after its tier: ${escaped} `),
        ),
      ]);
    });
  },
);
