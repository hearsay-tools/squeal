import { describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import { afterEachRun, CHILD_VARIABLE, type RunNote } from "../../src/core/daemon/escaped.js";
import {
  cutReading,
  type HostRow,
  type HostTable,
  heldByRun,
  outlivedNote,
  psRows,
  psTable,
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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `lstart` as `ps` prints it under `LC_ALL=C`, in local time. */
function lstart(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const time = `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
  const day = String(at.getDate()).padStart(2);
  return `${DAYS[at.getDay()]} ${MONTHS[at.getMonth()]} ${day} ${time} ${at.getFullYear()}`;
}

/** A `ps -A -E -ww -o pid=,ppid=,pgid=,stat=,lstart=,command=` line, started now unless `at`. */
function psLine(pid: number, ppid: number, pgrp: number, shown: string, at = new Date()): string {
  const id = (n: number) => String(n).padStart(5);
  return `${id(pid)} ${id(ppid)} ${id(pgrp)} Ss   ${lstart(at)} ${shown}`;
}

const DAEMON = process.pid;
/** The daemon's mark of the run's lane, `<token>:<lane>`, as `EscapedChildren.envFor` gives it. */
const OWN = "f00d:vitest";
const OWN_OUT = "/tmp/squeal-observe-own";
const OBSERVE = OBSERVED.variable;

/**
 * A Mac in the middle of a forced cancel: this daemon's worker of the run's
 * lane and what it started, beside what must not be named. The holders'
 * env is one of their own, as `env: { PATH }` gives, and still shows.
 */
function macListing(): string {
  const hourAgo = new Date(Date.now() - 3_600_000);
  return [
    psLine(DAEMON, 1, DAEMON, "node squeal.mjs daemon PATH=/usr/bin", hourAgo),
    // The run's worker, and below it a holder, a member of the holder's group and an older child.
    psLine(
      7001,
      DAEMON,
      DAEMON,
      `node process.js ${CHILD_VARIABLE}=${OWN} ${OBSERVE}=${settings(OWN_OUT, false)} PATH=/usr/bin`,
    ),
    psLine(7002, 7001, 7002, "node holder.cjs PATH=/usr/bin"),
    psLine(7003, 1, 7002, "node holder-child.cjs PATH=/usr/bin"),
    psLine(7004, 7001, 7004, "node old.cjs PATH=/usr/bin", hourAgo),
    // Another lane's worker of this daemon, its holder and the holder's group member.
    psLine(7101, DAEMON, DAEMON, `node process.js ${CHILD_VARIABLE}=f00d:other PATH=/usr/bin`),
    psLine(7102, 7101, 7102, "node holder.cjs PATH=/usr/bin"),
    psLine(7103, 1, 7102, "node holder-child.cjs PATH=/usr/bin"),
    // Another daemon, its worker of the same lane name and that worker's holder, and its recorder's holder.
    psLine(8000, 1, 8000, "node squeal.mjs daemon PATH=/usr/bin"),
    psLine(8001, 8000, 8000, `node process.js ${CHILD_VARIABLE}=beef:vitest PATH=/usr/bin`),
    psLine(8002, 8001, 8002, "node holder.cjs PATH=/usr/bin"),
    psLine(8003, 1, 8003, `node holder.cjs ${OBSERVE}=${settings("/tmp/squeal-observe-b", true)}`),
    // A child of the daemon whose env does not show (another user's), and its child.
    psLine(7301, DAEMON, DAEMON, "/usr/libexec/helper"),
    psLine(7302, 7301, 7302, "/usr/libexec/helper-child"),
    // A child of the daemon whose argument merely contains the mark, and its child.
    psLine(7401, DAEMON, DAEMON, `grep --regexp=${CHILD_VARIABLE}=${OWN} PATH=/usr/bin`),
    psLine(7402, 7401, 7402, "node holder.cjs PATH=/usr/bin"),
    // The research's holder, its leader gone: this instance's recorder settings, then with a space.
    psLine(7501, 1, 7501, `node holder.cjs ${OBSERVE}=${settings(OWN_OUT, true)} PATH=/usr/bin`),
    psLine(
      7502,
      1,
      7502,
      `node holder.cjs ${OBSERVE}={"out":"${OWN_OUT}","root":"/My Work","started":true}`,
    ),
  ].join("\n");
}

describe("psTable: macOS's table, the env as `ps -E` shows it (review 0.1.343 B1)", () => {
  it("names the run's worker's holder and group member, never another lane's, daemon's, hidden env's or argument's", async () => {
    const host = psTable({
      listing: async () => macListing(),
      command: async (pid) => `cmd-${pid}`,
    });
    const reading = cutReading(CHILD_VARIABLE, host);
    // The env the daemon gives the run's workers (`afterEachRun`'s `childEnv`, the recorder's settings).
    await reading.beforeForce({ [CHILD_VARIABLE]: OWN, [OBSERVE]: settings(OWN_OUT, false) });
    expect(await reading.note("run-1")).toBe(
      "3 processes tests started are still running after Squeal stopped their run run-1; Squeal did not stop the processes: " +
        "7002 cmd-7002 (parent 7001 cmd-7001); 7003 cmd-7003 (parent 1 cmd-1); 7501 cmd-7501 (parent 1 cmd-1). " +
        "`kill 7002 7003 7501` stops them.",
    );
  });

  it("reads a variable shown once on its line, up to the next space; anything else is null", async () => {
    let listing = async () =>
      [
        psLine(10, 1, 10, "node a.js NAME=one OTHER=x"),
        psLine(11, 1, 11, "node b.js NAME=one NAME=two"),
        psLine(12, 1, 12, "node c.js"),
        psLine(13, 1, 13, "node --x=NAME=one"),
        psLine(14, 1, 14, 'node d.js NAME={"root":"/My Work"}'),
        // Where `ps` shows the env before the command.
        psLine(15, 1, 15, "NAME=first node e.js"),
      ].join("\n");
    const host = psTable({ listing: () => listing(), command: async () => "" });
    expect(await host.variable(10, "NAME")).toBeNull();

    await host.list();
    const read = (pids: number[]) => Promise.all(pids.map((pid) => host.variable(pid, "NAME")));
    expect(await read([10, 11, 12, 13, 14, 15, 16])).toEqual([
      "one",
      null,
      null,
      null,
      '{"root":"/My',
      "first",
      null,
    ]);

    listing = () => Promise.reject(new Error("ps timed out"));
    await expect(host.list()).rejects.toThrow("ps timed out");
    expect(await read([10])).toEqual([null]);
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
