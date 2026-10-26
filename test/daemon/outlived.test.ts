import { describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import { afterEachRun, type RunNote } from "../../src/core/daemon/escaped.js";
import {
  cutReading,
  type HostRow,
  type HostTable,
  heldByRun,
  outlivedNote,
  psRows,
} from "../../src/core/daemon/outlived.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../src/core/types/index.js";
import type { RunCollector } from "../../src/runners/vitest/reporter.js";
import { execute } from "../../src/runners/vitest/run.js";

/*
 * Row 011-245 (gh-101): what a run cut by its forced cancel left. The ties
 * that make a process the run's, read from a table of this test's own; the
 * note the daemon writes after its sweep; and that only the forced cancel
 * awaits the daemon's hook, for a bounded time, whatever the hook does.
 */

const SELF = 100;
const SINCE = 5_000;
const MARK = { variable: "SQUEAL_DAEMON_CHILD", value: "token:vitest" };
const OBSERVED = { variable: "SQUEAL_OBSERVE", out: "/tmp/squeal-observe-a" };
const settings = (out: string, started: boolean) => JSON.stringify({ out, root: "/w", started });

/** A table of `rows` and their env, `null` an env it cannot read. */
function table(rows: readonly HostRow[], env: Record<number, Record<string, string> | null> = {}) {
  let lists = 0;
  const host: HostTable & { lists: () => number } = {
    mark: () => SINCE,
    list: async () => {
      lists += 1;
      return rows;
    },
    variable: async (pid, variable) => env[pid]?.[variable] ?? null,
    running: async (found) =>
      rows.filter((row) => found.some(({ pid, start }) => row.pid === pid && row.start === start)),
    command: async (pid) => (pid === 1 ? "/sbin/init" : `node holder-${pid}.cjs`),
    lists: () => lists,
  };
  return host;
}

const row = (pid: number, ppid: number, extra: Partial<HostRow> = {}): HostRow => ({
  pid,
  ppid,
  pgrp: SELF,
  session: SELF,
  start: SINCE + pid,
  ...extra,
});

describe("heldByRun: the processes a cut run's workers started (row 011-245)", () => {
  it("takes the descendants of the marked workers, never the workers or older processes", async () => {
    const host = table(
      [
        row(200, SELF),
        row(201, 200),
        row(202, 201),
        // A child of the daemon with no mark, such as esbuild's service started during the run.
        row(300, SELF),
        row(301, 300),
        // Below a worker but started before the run.
        row(203, 200, { start: SINCE - 1 }),
      ],
      { 200: { [MARK.variable]: MARK.value }, 300: {} },
    );

    const held = await heldByRun({ worker: MARK }, SINCE, host, SELF);
    expect(held.map(({ pid }) => pid).sort()).toEqual([201, 202]);
  });

  it("takes a member of a group or session a descendant leads, its leader gone", async () => {
    const host = table([
      row(200, SELF),
      row(201, 200, { pgrp: 201, session: 201 }),
      // Reparented to init when 201's child exited; still in 201's group.
      row(400, 1, { pgrp: 201, session: 201 }),
      // In 201's session, a group of its own.
      row(401, 1, { pgrp: 401, session: 201 }),
      // A stranger whose group id is no pid of the run.
      row(500, 1, { pgrp: 499, session: 499 }),
    ]);

    const held = await heldByRun({}, SINCE, host, SELF);
    expect(held.map(({ pid }) => pid).sort()).toEqual([201, 400, 401]);
  });

  it("takes a process a test started that carries the instance's recorder settings, wherever it is", async () => {
    const host = table(
      [
        row(200, SELF),
        // The research's holder: its leader exited, parent init, a group of its own.
        row(600, 1, { pgrp: 599, session: 599 }),
        // Another instance's, a process that no test started, and one whose env cannot be read.
        row(601, 1, { pgrp: 601, session: 601 }),
        row(602, 1, { pgrp: 602, session: 602 }),
        row(603, 1, { pgrp: 603, session: 603 }),
      ],
      {
        200: { [OBSERVED.variable]: JSON.stringify({ out: OBSERVED.out, root: "/w" }) },
        600: { [OBSERVED.variable]: settings(OBSERVED.out, true) },
        601: { [OBSERVED.variable]: settings("/tmp/squeal-observe-b", true) },
        602: { [OBSERVED.variable]: settings(OBSERVED.out, false) },
        603: null,
      },
    );

    const held = await heldByRun({ observed: OBSERVED }, SINCE, host, SELF);
    expect(held).toEqual([{ pid: 600, start: SINCE + 600 }]);
  });

  it("finds nothing when the table cannot be read", async () => {
    const host = { ...table([]), list: () => Promise.reject(new Error("EACCES")) };
    expect(await heldByRun({ worker: MARK, observed: OBSERVED }, SINCE, host, SELF)).toEqual([]);
  });
});

describe("outlivedNote (row 011-245)", () => {
  const host = table([row(600, 1), row(601, 1)]);

  it("names each one still running, with its parent and its run", async () => {
    const one = await outlivedNote([{ pid: 600, start: SINCE + 600 }], "run-1", host);
    expect(one).toBe(
      "1 process a test started is still running after Squeal stopped its run run-1; Squeal did not stop the process: " +
        "600 node holder-600.cjs (parent 1 /sbin/init). `kill 600` stops it.",
    );
    const two = await outlivedNote(
      [
        { pid: 600, start: SINCE + 600 },
        { pid: 601, start: SINCE + 601 },
      ],
      "run-2",
      host,
    );
    expect(two).toBe(
      "2 processes tests started are still running after Squeal stopped their run run-2; Squeal did not stop the processes: " +
        "600 node holder-600.cjs (parent 1 /sbin/init); 601 node holder-601.cjs (parent 1 /sbin/init). `kill 600 601` stops them.",
    );
  });

  it("is null when none still runs, a pid reused since included", async () => {
    expect(await outlivedNote([], "run-1", host)).toBeNull();
    expect(await outlivedNote([{ pid: 600, start: 1 }], "run-1", host)).toBeNull();
  });
});

describe("psRows: macOS's table (row 011-245)", () => {
  it("reads pid, parent, group and start; a zombie is left out", () => {
    const rows = psRows(
      [
        "  612     1   611 S    Mon Oct 26 05:17:01 2026",
        "  613   612   613 Z    Mon Oct 26 05:17:02 2026",
        "",
      ].join("\n"),
    );
    expect(rows).toEqual([
      {
        pid: 612,
        ppid: 1,
        pgrp: 611,
        session: null,
        start: new Date(2026, 9, 26, 5, 17, 1).getTime() / 1_000,
      },
    ]);
  });
});

const CUT_REPORT: RunReport = {
  end: "completed",
  durationMs: 1,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: "run cancelled",
};

const ENV = { [MARK.variable]: MARK.value, [OBSERVED.variable]: settings(OBSERVED.out, false) };

/** A Vitest whose run settles at the `settleAt`-th cancel, at once for 0. */
function fakeVitest(settleAt: number): Vitest {
  let settle = () => {};
  let cancels = 0;
  return {
    config: { env: ENV },
    runTestSpecifications: () =>
      new Promise<void>((resolve) => {
        settle = resolve;
        if (settleAt === 0) resolve();
      }),
    cancelCurrentRun: async () => {
      cancels += 1;
      if (cancels === settleAt) settle();
    },
  } as unknown as Vitest;
}

/** A collector that keeps its run-log notes. */
function collector(): RunCollector & { notes: string[] } {
  const notes: string[] = [];
  return { cancelRequested: false, note: (text: string) => notes.push(text), notes } as never;
}

/** `execute` of a fake Vitest, cancelled at once unless it ends by itself. */
async function executed(settleAt: number, beforeForce?: (env: unknown) => Promise<void>) {
  const log = collector();
  const controller = new AbortController();
  const running = execute(fakeVitest(settleAt), [], null, log, controller.signal, beforeForce);
  // At 0 the run ends by itself, never cancelled.
  if (settleAt > 0) controller.abort("supersession");
  return { execution: await running, notes: log.notes };
}

describe("execute awaits beforeForce only at a forced cancel (row 011-245)", () => {
  it("not for a run that ends by itself or in the first cancel's grace", async () => {
    const calls: unknown[] = [];
    const hook = async (env: unknown) => {
      calls.push(env);
    };
    await executed(0, hook);
    await executed(1, hook);
    expect(calls).toEqual([]);
  });

  it("once at the forced cancel, with the env the instance gave its workers", async () => {
    const calls: unknown[] = [];
    const { execution } = await executed(2, async (env) => {
      calls.push(env);
    });
    expect(calls).toEqual([ENV]);
    expect(execution.failure).toMatch(/^run cancelled: the revisions/);
  });

  it("leaves the run as a run with no hook when the hook throws, rejects or never ends", async () => {
    const plain = (await executed(2)).execution;
    const thrown = await executed(2, () => {
      throw new Error("at once");
    });
    const rejected = await executed(2, () => Promise.reject(new Error("later")));
    const started = Date.now();
    const hung = await executed(2, () => new Promise<void>(() => {}));
    expect([thrown.execution, rejected.execution, hung.execution]).toEqual([plain, plain, plain]);
    expect(thrown.notes.some((line) => line.startsWith("beforeForce: Error: at once"))).toBe(true);
    expect(rejected.notes.some((line) => line.startsWith("beforeForce: Error: later"))).toBe(true);
    // The forced cancel waits 500 ms for it, then goes on.
    expect(Date.now() - started).toBeLessThan(1_000 + 500 + 400);
  });
});

describe("cutReading: one run's hook and note (row 011-245)", () => {
  it("names what the hook found still running after the run, and nothing before the hook ran", async () => {
    const host = table([row(600, 1, { pgrp: 599, session: 599 })], {
      600: { [OBSERVED.variable]: settings(OBSERVED.out, true) },
    });
    const reading = cutReading(MARK.variable, host);
    expect(await reading.note("run-1")).toBeNull();
    await reading.beforeForce(ENV);
    expect(await reading.note("run-1")).toMatch(
      /^1 process a test started .* `kill 600` stops it\.$/,
    );
  });

  it("never rejects, and notes nothing, when the table cannot be read", async () => {
    const broken: HostTable = {
      ...table([]),
      mark: () => {
        throw new Error("no clock");
      },
    };
    const reading = cutReading(MARK.variable, broken);
    await expect(reading.beforeForce(ENV)).resolves.toBeUndefined();
    expect(await reading.note("run-1")).toBeNull();
  });
});

describe("afterEachRun names what a cut run left (row 011-245)", () => {
  it("after its sweep, in a note of its own with no `stopped`, through the hook of the run's options", async () => {
    const host = table([row(600, 1, { pgrp: 599, session: 599 })], {
      600: { [OBSERVED.variable]: settings(OBSERVED.out, true) },
    });
    const runner = {
      name: "fake",
      run: async (_: unknown, options: RunOptions) => {
        await options.beforeForce?.(ENV);
        return CUT_REPORT;
      },
    } as unknown as RunnerAdapter;
    const notes: RunNote[] = [];
    const sweeper = {
      mark: () => 0,
      envFor: () => ({}),
      carriers: async () => [],
      afterRun: async () => ({ text: "the sweep's", stopped: { what: "w", commands: [] } }),
    };
    const wrapped = afterEachRun(runner, sweeper, (note) => notes.push(note), host);
    const report = await wrapped.run([], { runId: "run-9", logDir: "/tmp/run-9", timeoutMs: null });

    expect(report).toBe(CUT_REPORT);
    expect(notes).toEqual([
      { text: "the sweep's", stopped: { what: "w", commands: [] } },
      {
        text:
          "1 process a test started is still running after Squeal stopped its run run-9; " +
          "Squeal did not stop the process: 600 node holder-600.cjs (parent 1 /sbin/init). `kill 600` stops it.",
      },
    ]);
  });
});
