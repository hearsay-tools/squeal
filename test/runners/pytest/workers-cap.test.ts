import { describe, expect, it, vi } from "vitest";
import type { RunOptions } from "../../../src/core/types/runner.js";

/*
 * Row 026-33 (#292): a pytest run starts no more processes at once than
 * the tier's grant (`RunOptions.workers`), and the project's concurrency
 * when it has no grant; a run in a check group's lane starts every file,
 * each alone (007 D6, 019 D3). `runPytest` and the environment's sync check
 * are stood in for.
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

vi.mock("../../../src/runners/pytest/environment/states.js", async (actual) => ({
  ...(await actual<typeof import("../../../src/runners/pytest/environment/states.js")>()),
  syncNote: () => null,
}));
vi.mock("../../../src/runners/pytest/environment/fingerprint.js", async (actual) => ({
  ...(await actual<typeof import("../../../src/runners/pytest/environment/fingerprint.js")>()),
  readEnvironmentFiles: () => [],
  environmentFingerprint: () => "f",
}));

const { runProject } = await import("../../../src/runners/pytest/adapter-run.js");

type Context = Parameters<typeof runProject>[0];

function contextWith(options: Record<string, unknown>): Context {
  return {
    root: "/r",
    project: { name: "py" },
    environment: {
      state: "ready",
      fingerprint: "f",
      discovery: { env: "/r/.venv", python: "python" },
    },
    names: {},
    options,
  } as unknown as Context;
}

const sized = contextWith({ concurrency: () => 4 });
const unsized = contextWith({});
const FILES = ["a", "b", "c", "d"].map((name) => ({ project: "py", path: `test_${name}.py` }));

/** What `runPytest` was given for a 4-file run. */
async function given(context: Context, extra: Partial<RunOptions>) {
  calls.length = 0;
  await runProject(context, FILES, { runId: "r", logDir: "/tmp/r", timeoutMs: null, ...extra });
  const [call] = calls;
  return { concurrency: call?.concurrency ?? null, alone: call?.alone !== undefined };
}

describe("a pytest run at its grant (row 026-33, #292)", () => {
  it("starts no more processes at once than its workers", async () => {
    expect(await given(sized, { workers: 1 })).toEqual({ concurrency: 1, alone: false });
    expect(await given(sized, { workers: 2, lane: "pytest" })).toEqual({
      concurrency: 2,
      alone: false,
    });
    expect(await given(sized, { workers: 3, lane: "beside:pytest" })).toEqual({
      concurrency: 3,
      alone: false,
    });
  });

  it("keeps the project's concurrency at a larger grant and without one", async () => {
    expect(await given(sized, { workers: 8 })).toEqual({ concurrency: 4, alone: false });
    expect(await given(sized, {})).toEqual({ concurrency: 4, alone: false });
  });

  it("runs at its workers when the project sets no concurrency, and at least 1", async () => {
    expect(await given(unsized, { workers: 2 })).toEqual({ concurrency: 2, alone: false });
    expect(await given(unsized, { workers: 0 })).toEqual({ concurrency: 1, alone: false });
    expect(await given(unsized, {})).toEqual({ concurrency: null, alone: false });
  });

  it("starts every file alone in a group's lane, whatever its workers", async () => {
    expect(await given(sized, { workers: 1, lane: "slow:pytest" })).toEqual({
      concurrency: null,
      alone: true,
    });
    expect(await given(sized, { workers: 1, lane: "group:e2e:pytest" })).toEqual({
      concurrency: null,
      alone: true,
    });
  });
});
