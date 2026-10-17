import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Review wave-1.13 B1 (task 001-438): a slow lane's failed `ionice` batch is
 * retried one pid at a time, each only while it still names the process the
 * walk found. The kernel's table, the priority calls and `execFile` are
 * stood in for, so a pid replaced while the batch ran is deterministic.
 */

const kernel = vi.hoisted(() => ({
  table: new Map<number, number>(),
  batch: null as null | ((error: { code: number } | null) => void),
  singles: [] as number[],
}));

vi.mock("node:os", async (actual) => ({
  ...(await actual<typeof import("node:os")>()),
  getPriority: () => 0,
  setPriority: () => {},
}));

vi.mock("node:child_process", async (actual) => ({
  ...(await actual<typeof import("node:child_process")>()),
  execFile: (_file: string, args: string[], done: (error: unknown) => void) => {
    const pids = args.slice(3).map(Number);
    if (kernel.batch === null && pids.length > 1) kernel.batch = done;
    else {
      kernel.singles.push(...pids);
      done(null);
    }
    return { unref: () => {} };
  },
}));

vi.mock("../../src/core/daemon/terminate.js", async (actual) => ({
  ...(await actual<typeof import("../../src/core/daemon/terminate.js")>()),
  statOf: (pid: number) => {
    const start = kernel.table.get(pid);
    return start === undefined ? null : { pid, ppid: 1, pgrp: 1, start };
  },
}));

const { lowerWhile } = await import("../../src/core/daemon/low-priority.js");

afterEach(() => {
  kernel.table.clear();
  kernel.batch = null;
  kernel.singles = [];
});

describe.runIf(process.platform === "linux")(
  "lowerWhile: a failed ionice batch (wave-1.13 B1)",
  () => {
    it("retries only the pids that still name the processes it found", async () => {
      for (const pid of [101, 202, 303, 404]) kernel.table.set(pid, pid / 101);
      const carrier = { pid: 101, ppid: 1, pgrp: 1, start: 1 };
      const settled = new AbortController();
      const lowering = lowerWhile(
        { carriers: async () => [carrier] },
        "slow:vitest",
        0,
        settled.signal,
        () => [
          { pid: 202, start: 2 },
          { pid: 303, start: 3 },
          { pid: 404, start: 4 },
        ],
      );
      try {
        for (let waited = 0; kernel.batch === null && waited < 5_000; waited += 20)
          await new Promise((r) => setTimeout(r, 20));
        expect(kernel.batch).not.toBeNull();
        // While the batch runs, 202 exits and its pid names another process; 404 exits.
        kernel.table.set(202, 2002);
        kernel.table.delete(404);
        kernel.batch?.({ code: 1 });
        expect(kernel.singles).toEqual([101, 303]);
      } finally {
        settled.abort();
        await lowering;
      }
    });
  },
);
