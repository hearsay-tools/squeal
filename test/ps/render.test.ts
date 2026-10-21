import { describe, expect, test } from "vitest";
import { render } from "../../src/core/ps/render.js";
import type { PsFlag } from "../../src/core/ps/shape.js";
import { EXAMPLE_AT, exampleDaemon, exampleProcess, exampleSnapshot } from "./fixture-snapshot.js";

/*
 * Spec 014 D8 (task 014-11): the text of `squeal ps`, from the shape alone,
 * against the D8 layout: the first line is the answer, then the host line,
 * the Squeal line, one block per repository and the files section. A
 * flagged row starts with `!` and has its reason and an `ends it:` line
 * under it. A `null` prints as unknown, never as 0.
 */

const MIB = 2 ** 20;
const lines = (text: string) => text.split("\n");
const brief = (s = exampleSnapshot()) => render(s, { full: false });

describe("the D8 layout", () => {
  test("the first line, the host line and the Squeal line", () => {
    expect(lines(brief()).slice(0, 3)).toEqual([
      "squeal ps · 3 daemons, 1 test process · 2 flags: stale-socket, leftover-temp",
      "Host    load 36.8 41.3 51.1 on 24 CPUs · CPU pressure 45% · memory pressure 0.6% (0.5% full) · memory 32.7 of 47.0 GiB used, swap 4.0 of 4.0 GiB",
      "Squeal  CPU 8.1 CPUs (36% of busy) · memory 21.0 GiB (64% of used) + 1.0 GiB swap · pool 3 of 12 permits",
    ]);
  });

  test("the first line says no flags, and names a repeated flag once with its count", () => {
    expect(lines(brief(exampleSnapshot({ files: [], flags: 0 })))[0]).toBe(
      "squeal ps · 3 daemons, 1 test process · no flags",
    );
    const [socket, leftovers] = exampleSnapshot().files;
    if (socket === undefined || leftovers === undefined)
      throw new Error("the example has two files");
    const other = { ...socket, path: "/tmp/squeal-1001/squeal-0000000000000000.sock" };
    const twice = exampleSnapshot({ files: [socket, other, leftovers], flags: 3 });
    expect(lines(brief(twice))[0]).toBe(
      "squeal ps · 3 daemons, 1 test process · 3 flags: stale-socket ×2, leftover-temp",
    );
  });

  test("a repository block: its line, the columns, a daemon, its test process, and a state too wide for its column on a line of its own", () => {
    const text = lines(brief());
    const at = text.indexOf(
      "/home/user/projects/cezar (this repository) · 3 daemons · CPU 0.7 · memory 4.4 GiB",
    );
    expect(at).toBe(4);
    expect(text.slice(at + 1, at + 7)).toEqual([
      "  STATE              PID      WORKTREE  VERSION          UP   CPU  CPU TIME  MEMORY  SWAP  WORK",
      "  serving            3704612  f1ca49e6  0.1.235 codex   39m   30%    11m42s  2.2G    264M  fast tier, 200 files",
      "    vitest           3704700  fork worker                4m   12%     0m29s  310M    0     nice 10, +2 children",
      "  draining 22m left  2721938  aee4a33f  0.1.235 codex   61m   16%     9m10s  1.1G    80M   120 pending; session left 38m ago",
      "  older (session 3212240 holds it)",
      "                     3241641  70b80c8e  0.1.234 claude  49m   12%     5m51s  821M    0     idle",
    ]);
    // Left columns start under their titles, right ones end under theirs.
    const [header, serving] = [text[at + 1] ?? "", text[at + 2] ?? ""];
    expect(serving.indexOf("3704612")).toBe(header.indexOf("PID"));
    expect(serving.indexOf("2.2G")).toBe(header.indexOf("MEMORY"));
    expect(serving.indexOf("11m42s") + 6).toBe(header.indexOf("CPU TIME") + 8);
  });

  test("the files section: each flagged file with `!`, its reason and the command that ends it", () => {
    const text = lines(brief());
    const at = text.indexOf("Files no live process uses");
    expect(text.slice(at, at + 5)).toEqual([
      "Files no live process uses",
      "  ! stale-socket  /run/user/1001/squeal-fd5a859b8ca77ef9.sock (no live daemon of worktree fd5a859b8ca77ef9 holds its lock; changed 2026-10-16 20:36)",
      "      ends it: rm /run/user/1001/squeal-fd5a859b8ca77ef9.sock",
      "  ! leftover-temp  3,530 directories, 6.4 GiB (no live daemon's key names them and no process uses them, older than 1 h)",
      "      ends it: squeal ps --leftovers | xargs -d '\\n' rm -rf --",
    ]);
    expect(text.at(-1)).toBe("");
  });
});

describe("flagged rows", () => {
  const hung: PsFlag = {
    flag: "hung",
    reason: "its heartbeat is 40 s old on both samples, past two intervals of 5 s",
    command: "kill 3704612, then kill -9 3704612",
  };

  test("a flagged daemon starts with `!`, its reason and its `ends it:` line under it", () => {
    const s = exampleSnapshot({
      repositories: [
        { commonDir: null, current: false, daemons: [exampleDaemon({ flags: [hung] })] },
      ],
      files: [],
      flags: 1,
    });
    const text = lines(brief(s));
    expect(text[0]).toBe("squeal ps · 3 daemons, 1 test process · 1 flag: hung");
    expect(text[4]).toBe("repository unknown · 1 daemon · CPU 0.3 · memory 2.2 GiB");
    const row = text.findIndex((l) => l.startsWith("! serving"));
    expect(text.slice(row + 1, row + 3)).toEqual([
      "      hung: its heartbeat is 40 s old on both samples, past two intervals of 5 s",
      "      ends it: kill 3704612, then kill -9 3704612",
    ]);
  });

  test("a flagged test process and a flag without a command", () => {
    const flag: PsFlag = { flag: "dead-consumer", reason: "session s1 is gone", command: null };
    const overdue: PsFlag = {
      flag: "overdue-test-process",
      reason: "older than 10 min",
      command: "kill 3704700",
    };
    const s = exampleSnapshot({
      repositories: [
        {
          commonDir: "/r/.git",
          current: false,
          daemons: [
            exampleDaemon({
              flags: [flag],
              processes: [exampleProcess({ escaped: true, flags: [overdue] })],
            }),
          ],
        },
      ],
    });
    const text = brief(s);
    expect(text).toContain("      dead-consumer: session s1 is gone\n      ends it: none\n");
    expect(text).toMatch(
      /\n! {3}vitest {11}3704700 .* escaped, nice 10, \+2 children\n {6}overdue-test-process: older than 10 min\n {6}ends it: kill 3704700\n/,
    );
  });

  test("an orphan, under the processes no live daemon owns", () => {
    const s = exampleSnapshot({
      orphans: [
        {
          pid: 3999,
          comm: "node",
          startedAt: EXAMPLE_AT - 2 * 3_600_000,
          flags: [
            {
              flag: "orphan-test-process",
              reason: "its mark's token names no live daemon",
              command: "kill 3999",
            },
          ],
        },
      ],
    });
    expect(brief(s)).toContain(
      "\nProcesses no live daemon owns\n  ! orphan-test-process  pid 3999 node, up 2h (its mark's token names no live daemon)\n      ends it: kill 3999\n",
    );
  });
});

describe("unknown values print as unknown, never 0", () => {
  test("the host and Squeal lines, and the columns", () => {
    const base = exampleSnapshot();
    const s = exampleSnapshot({
      host: {
        load: null,
        cpus: 8,
        cpuPressure: null,
        memoryPressure: null,
        memTotal: null,
        memAvailable: null,
        swapTotal: null,
        swapUsed: null,
        busyCpuPct: null,
      },
      squeal: {
        ...base.squeal,
        cpuPct: null,
        cpuShare: null,
        privateBytes: null,
        memoryShare: null,
        swapBytes: null,
        pool: { slots: 7, held: null },
      },
      repositories: [
        {
          commonDir: "/r/.git",
          current: false,
          daemons: [
            exampleDaemon({
              worktreeId: null,
              version: null,
              harness: null,
              startedAt: null,
              cpuPct: null,
              cpuMs: null,
              privateBytes: null,
              swapBytes: null,
              work: { ...exampleDaemon().work, tiers: [], pending: null, running: null },
            }),
          ],
        },
      ],
      unknown: [{ what: "host load", why: "the source cannot read it on this host" }],
    });
    const text = lines(brief(s));
    expect(text[1]).toBe(
      "Host    load unknown on 8 CPUs · CPU pressure unknown · memory pressure unknown · memory unknown, swap unknown",
    );
    expect(text[2]).toBe(
      "Squeal  CPU unknown · memory unknown (share of used unknown) + swap unknown · pool 7 permits, held unknown",
    );
    expect(text[4]).toBe("/r · 1 daemon · CPU unknown · memory unknown");
    expect(text[6]).toBe(
      "  serving            3704612  ?         ?                 ?     ?         ?  ?       ?     work unknown",
    );
    expect(text.at(-2)).toBe("Unknown: 1 value; --full names each");
  });

  test("on macOS, memory is RSS and says it counts shared pages more than once", () => {
    const text = lines(brief(exampleSnapshot({ memory: "rss" })));
    expect(text[2]).toBe(
      "Squeal  CPU 8.1 CPUs (36% of busy) · RSS 21.0 GiB (64% of used), shared pages counted more than once + 1.0 GiB swap · pool 3 of 12 permits",
    );
    expect(text[5]).toContain(" RSS     SWAP  WORK");
  });
});

describe("--full", () => {
  test("each descendant on a line of its own, the files that never get a flag, and each unknown", () => {
    const process = exampleProcess({
      descendants: {
        ...exampleProcess().descendants,
        count: 1,
        list: [
          {
            pid: 3704800,
            comm: "git",
            cpuPct: 2,
            cpuMs: 2_000,
            privateBytes: 10 * MIB,
            swapBytes: 0,
          },
        ],
      },
    });
    const s = exampleSnapshot({
      repositories: [
        {
          commonDir: "/r/.git",
          current: false,
          daemons: [exampleDaemon({ processes: [process] })],
        },
      ],
      unflaggedFiles: [
        { kind: "lock", count: 12 },
        { kind: "session-root", count: 2 },
      ],
      unknown: [{ what: "daemon 3704612 lastUsedAt", why: "a release before D9" }],
    });
    const full = lines(render(s, { full: true }));
    const worker = full.findIndex((l) => l.startsWith("    vitest"));
    expect(full[worker]).toContain("+1 child");
    expect(full[worker + 1]).toBe(
      "      git            3704800                                   2%     0m02s  10M     0",
    );
    expect(full).toContain("Files that never get a flag: lock 12, session-root 2");
    expect(full.slice(-3)).toEqual([
      "Unknown",
      "  daemon 3704612 lastUsedAt: a release before D9",
      "",
    ]);
    // Without --full the snapshot holds no counts, and the shape alone decides.
    expect(brief({ ...s, unflaggedFiles: null })).not.toContain("never get a flag");
  });
});
