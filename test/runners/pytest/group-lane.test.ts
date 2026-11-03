import { describe, expect, it, vi } from "vitest";
import type { RunOptions } from "../../../src/core/types/index.js";

/*
 * Spec 004 D2, 007 D6, 019 D3 (row 019-12): a run in a check group's lane,
 * the default `slow` group's `slow:pytest` or a configured group's
 * `group:<name>:pytest`, starts every file it holds, each alone; a run in
 * the adapter's own lane or a beside lane keeps the project's concurrency.
 * `runPytest` and the environment's sync check are stood in for.
 */

const calls = vi.hoisted(() => [] as { concurrency?: number; alone?: unknown }[]);

vi.mock("../../../src/runners/pytest/run/run.js", () => ({
  runPytest: async (options: { concurrency?: number; alone?: unknown }) => {
    calls.push({
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      ...(options.alone === undefined ? {} : { alone: options.alone }),
    });
    return {
      report: {
        end: "completed",
        durationMs: 1,
        completedFiles: [],
        results: [],
        fileErrors: [],
        failure: null,
      },
      skippedFiles: [],
    };
  },
}));

vi.mock("../../../src/runners/pytest/environment/index.js", async (actual) => ({
  ...(await actual<typeof import("../../../src/runners/pytest/environment/index.js")>()),
  syncNote: () => null,
  readEnvironmentFiles: () => [],
  environmentFingerprint: () => "f",
}));

const { runProject } = await import("../../../src/runners/pytest/adapter-run.js");

const context = {
  root: "/r",
  project: { name: "py" },
  environment: { state: "ready", fingerprint: "f", discovery: { env: {}, python: "python" } },
  names: {},
  options: { concurrency: () => 4 },
} as unknown as Parameters<typeof runProject>[0];

/** What `runPytest` was given for a run in `lane`. */
async function given(lane: string | undefined) {
  calls.length = 0;
  const options: RunOptions = {
    runId: "r",
    logDir: "/tmp/r",
    timeoutMs: null,
    ...(lane === undefined ? {} : { lane }),
  };
  await runProject(context, [{ project: "py", path: "test_a.py" }], options);
  const [call] = calls;
  return { concurrency: call?.concurrency ?? null, alone: call?.alone !== undefined };
}

describe("a pytest run in a group's lane (spec 019 D3, row 019-12)", () => {
  it("starts every file alone in a group's lane, the slow one's included", async () => {
    expect(await given("slow:pytest")).toEqual({ concurrency: null, alone: true });
    expect(await given("group:e2e:pytest")).toEqual({ concurrency: null, alone: true });
  });

  it("keeps the project's concurrency in its own lane and a beside lane", async () => {
    expect(await given("pytest")).toEqual({ concurrency: 4, alone: false });
    expect(await given("beside:pytest")).toEqual({ concurrency: 4, alone: false });
    expect(await given(undefined)).toEqual({ concurrency: 4, alone: false });
  });
});
