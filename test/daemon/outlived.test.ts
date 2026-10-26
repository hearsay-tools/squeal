import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Vitest } from "vitest/node";
import { afterEachRun, type RunNote } from "../../src/core/daemon/escaped.js";
import {
  type HostRow,
  type HostTable,
  heldByRun,
  outlivedNote,
  psRows,
} from "../../src/core/daemon/outlived.js";
import type { RunnerAdapter, RunReport } from "../../src/core/types/index.js";
import type { RunCollector } from "../../src/runners/vitest/reporter.js";
import { execute } from "../../src/runners/vitest/run.js";
import { isAlive } from "./strays.js";

/*
 * Row 011-245 (gh-101): what a run cut by its forced cancel left. The ties
 * that make a process the run's, read from a table of this test's own; the
 * note the daemon writes after its sweep; and that only the forced cancel
 * reads the host.
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

/** A Vitest whose run settles at the `settleAt`-th cancel, at once for 0. */
function fakeVitest(settleAt: number): Vitest {
  let settle = () => {};
  let cancels = 0;
  return {
    config: { env: { [MARK.variable]: MARK.value } },
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

const collector = () => ({ cancelRequested: false, note: () => {} }) as unknown as RunCollector;

describe("execute reads the host only at a forced cancel (row 011-245)", () => {
  it("not for a run that ends by itself or in the first cancel's grace", async () => {
    const host = table([row(200, SELF)]);
    await execute(fakeVitest(0), [], null, collector(), new AbortController().signal, host);
    const controller = new AbortController();
    const graceful = execute(fakeVitest(1), [], null, collector(), controller.signal, host);
    controller.abort("supersession");
    expect((await graceful).outlived).toBeUndefined();
    expect(host.lists()).toBe(0);
  });

  it("once at the forced cancel, keeping what still runs once it settled", async () => {
    // `execute` reads as the daemon, this process.
    const host = table([row(200, process.pid), row(201, 200)], {
      200: { [MARK.variable]: MARK.value },
    });
    const controller = new AbortController();
    const forced = execute(fakeVitest(2), [], null, collector(), controller.signal, host);
    controller.abort("supersession");
    expect((await forced).outlived).toEqual([{ pid: 201, start: SINCE + 201 }]);
    expect(host.lists()).toBe(1);
  });
});

describe.runIf(process.platform === "linux")(
  "afterEachRun names what a cut run left (row 011-245)",
  () => {
    it("after its sweep, in a note of its own, and stops none of it", async () => {
      const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
        detached: true,
        stdio: "ignore",
        env: { PATH: process.env.PATH ?? "" },
      });
      const pid = holder.pid ?? 0;
      onTestFinished(() => {
        if (isAlive(pid)) holder.kill("SIGKILL");
      });
      await new Promise((done) => holder.once("spawn", done));
      const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
      const start = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
      const runner = {
        name: "fake",
        run: async () => ({ ...CUT_REPORT, outlived: [{ pid, start }] }),
      } as unknown as RunnerAdapter;
      const notes: RunNote[] = [];
      const sweeper = {
        mark: () => 0,
        envFor: () => ({}),
        carriers: async () => [],
        afterRun: async () => ({ text: "the sweep's", stopped: { what: "w", commands: [] } }),
      };
      await afterEachRun(runner, sweeper, (note) => notes.push(note)).run([], {
        runId: "run-9",
        logDir: "/tmp/run-9",
        timeoutMs: null,
      });

      expect(notes.map(({ text }) => text.slice(0, 40))).toEqual([
        "the sweep's",
        "1 process a test started is still runnin",
      ]);
      expect(notes[1]?.text).toContain(
        " after Squeal stopped its run run-9; Squeal did not stop the process: ",
      );
      expect(notes[1]?.text).toContain(
        `: ${pid} ${process.execPath} -e setTimeout(() => {}, 60_000) (parent `,
      );
      expect(notes[1]?.text.endsWith(`). \`kill ${pid}\` stops it.`)).toBe(true);
      expect(notes[1]?.stopped).toBeUndefined();
      expect(isAlive(pid)).toBe(true);
    });
  },
);
