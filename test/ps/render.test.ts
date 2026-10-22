import { describe, expect, test } from "vitest";
import { render } from "../../src/core/ps/render.js";
import type { PsDaemon, PsFlag, PsTestProcess } from "../../src/core/ps/shape.js";
import {
  EXAMPLE_AT,
  exampleDaemon,
  exampleProcess,
  exampleRepository,
  exampleSnapshot,
  NO_SKIP,
} from "./fixture-snapshot.js";

/*
 * Spec 014 D8 (task 014-11): the text of `squeal ps`, from the shape alone,
 * against the D8 layout: the first line is the answer, then the host line,
 * the Squeal line, one block per repository and the files section. A
 * flagged row starts with `!` and has its reason and an `ends it:` line
 * under it. A `null` prints as unknown, never as 0.
 */

const MIB = 2 ** 20;
const MINUTE = 60_000;
const lines = (text: string) => text.split("\n");
const brief = (s = exampleSnapshot()) => render(s, { full: false });

describe("the D8 layout", () => {
  test("the first line, the host line and the Squeal line", () => {
    expect(lines(brief()).slice(0, 3)).toEqual([
      "squeal ps · 3 daemons, 1 test process · 2 flags: stale-socket, stale-pool-mark",
      "Host    load 36.8 41.3 51.1 on 24 CPUs · CPU pressure 45% · memory pressure 0.6% (0.5% full) · memory 32.7 of 47.0 GiB used, swap 4.0 of 4.0 GiB",
      "Squeal  CPU 8.1 CPUs (36% of busy) · memory 21.0 GiB (64% of used) + 1.0 GiB swap · pool 3 of 12 permits",
    ]);
  });

  test("the first line says no flags, and names a repeated flag once with its count", () => {
    expect(lines(brief(exampleSnapshot({ files: [], flags: 0 })))[0]).toBe(
      "squeal ps · 3 daemons, 1 test process · no flags",
    );
    const [socket, mark] = exampleSnapshot().files;
    if (socket === undefined || mark === undefined) throw new Error("the example has two files");
    const other = { ...socket, path: "/tmp/squeal-1001/squeal-0000000000000000.sock" };
    const twice = exampleSnapshot({ files: [socket, other, mark], flags: 3 });
    expect(lines(brief(twice))[0]).toBe(
      "squeal ps · 3 daemons, 1 test process · 3 flags: stale-socket ×2, stale-pool-mark",
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
      "  ! stale-pool-mark  /run/user/1001/squeal/pool.mark.0011223344556677 (unchanged since 2026-10-21 18:02; readers skip a mark older than 30 s)",
      "      ends it: rm /run/user/1001/squeal/pool.mark.0011223344556677",
    ]);
    expect(text.at(-1)).toBe("");
  });
});

describe("a sum that leaves an unknown value out is a lower bound (task 014-24)", () => {
  const out = { cpuPct: 1, privateBytes: 2, swapBytes: 1 };

  test("the Squeal line says at least before each total and share that leaves a value out", () => {
    const base = exampleSnapshot();
    const s = exampleSnapshot({ squeal: { ...base.squeal, skipped: out } });
    expect(lines(brief(s))[2]).toBe(
      "Squeal  CPU at least 8.1 CPUs (at least 36% of busy) · memory at least 21.0 GiB (at least 64% of used) + at least 1.0 GiB swap · pool 3 of 12 permits",
    );
    const cpuOnly = exampleSnapshot({
      squeal: { ...base.squeal, skipped: { ...NO_SKIP, cpuPct: 3 } },
    });
    expect(lines(brief(cpuOnly))[2]).toBe(
      "Squeal  CPU at least 8.1 CPUs (at least 36% of busy) · memory 21.0 GiB (64% of used) + 1.0 GiB swap · pool 3 of 12 permits",
    );
  });

  test("the repository line says at least before a total that leaves a value out", () => {
    const daemons = [exampleDaemon({ processes: [exampleProcess()] })];
    const s = exampleSnapshot({
      repositories: [exampleRepository("/r/.git", false, daemons, out)],
    });
    expect(lines(brief(s))[4]).toBe("/r · 1 daemon · CPU at least 0.4 · memory at least 2.5 GiB");
  });

  test("a test process's column takes a + when its descendants' sum leaves a value out", () => {
    const descendants = {
      ...exampleProcess().descendants,
      skipped: { ...NO_SKIP, privateBytes: 1 },
    };
    const daemons = [exampleDaemon({ processes: [exampleProcess({ descendants })] })];
    const s = exampleSnapshot({ repositories: [exampleRepository("/r/.git", false, daemons)] });
    expect(lines(brief(s)).find((l) => l.includes(" 3704700 "))).toBe(
      "    vitest           3704700  fork worker                4m   12%     0m29s  310M+   0     nice 10, +2 children",
    );
  });

  test("a worker whose descendants all left prints its own values with theirs at 0, never ? (lessons.md P4)", () => {
    const gone = {
      count: 2,
      cpuPct: 0,
      cpuMs: 2_000,
      privateBytes: 0,
      swapBytes: 0,
      skipped: NO_SKIP,
      list: null,
    };
    const daemons = [exampleDaemon({ processes: [exampleProcess({ descendants: gone })] })];
    const s = exampleSnapshot({ repositories: [exampleRepository("/r/.git", false, daemons)] });
    expect(lines(brief(s)).find((l) => l.includes(" 3704700 "))).toBe(
      "    vitest           3704700  fork worker                4m   10%     0m29s  300M    0     nice 10, +2 children",
    );
  });
});

describe("the departure in the work text (task 014-27, lessons.md P7)", () => {
  const consumer = { harnessPid: 3212240, alive: true, version: "0.1.235" };
  const workOf = (overrides: Partial<PsDaemon>) => {
    const daemons = [exampleDaemon({ work: { ...exampleDaemon().work, tiers: [] }, ...overrides })];
    const s = exampleSnapshot({ repositories: [exampleRepository("/r/.git", false, daemons)] });
    const row = lines(brief(s)).find((l) => l.includes(" 3704612 ")) ?? "";
    return row.slice(row.indexOf("264M") + 6);
  };
  const departed = (minutesAgo: number) => ({
    ...exampleDaemon().work,
    tiers: [],
    departedAt: EXAMPLE_AT - minutesAgo * MINUTE,
  });

  test("a daemon with a consumer and a departure before its start prints no session left", () => {
    expect(workOf({ consumers: [consumer], work: departed(20 * 60) })).toBe("1 session");
  });

  test("a departure before its start is a predecessor's, and a consumer that came after a departure holds it: neither prints", () => {
    expect(workOf({ work: departed(20 * 60) })).toBe("idle");
    expect(workOf({ consumers: [consumer], work: departed(5) })).toBe("1 session");
  });

  test("its own departure, after its start and with no consumer, prints; with its start unknown, none does", () => {
    expect(workOf({ work: departed(5) })).toBe("session left 5m ago");
    expect(workOf({ startedAt: null, work: departed(5) })).toBe("idle");
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
      repositories: [exampleRepository(null, false, [exampleDaemon({ flags: [hung] })])],
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
        exampleRepository("/r/.git", false, [
          exampleDaemon({
            flags: [flag],
            processes: [exampleProcess({ escaped: true, flags: [overdue] })],
          }),
        ]),
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
        skipped: NO_SKIP,
        pool: { slots: 7, held: null },
      },
      repositories: [
        exampleRepository("/r/.git", false, [
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
        ]),
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

  describe("a test process's columns (reviews/wave-2.md B3)", () => {
    const none = {
      count: 0,
      cpuPct: 0,
      cpuMs: 0,
      privateBytes: 0,
      swapBytes: 0,
      skipped: NO_SKIP,
      list: null,
    };
    const rowOf = (p: PsTestProcess, memory: "private" | "rss" = "private") => {
      const daemons = [exampleDaemon({ processes: [p] })];
      const s = exampleSnapshot({
        memory,
        repositories: [exampleRepository("/r/.git", false, daemons)],
      });
      return lines(brief(s)).find((l) => l.includes(" 3704700 "));
    };

    test("a worker that left during the window, without descendants: its unread CPU and memory are unknown", () => {
      const vanished = { cpuPct: null, privateBytes: null, swapBytes: null, descendants: none };
      expect(rowOf(exampleProcess(vanished))).toBe(
        "    vitest           3704700  fork worker                4m     ?     0m27s  ?       ?     nice 10",
      );
    });

    test("an RSS worker without descendants: its swap is unknown", () => {
      expect(rowOf(exampleProcess({ swapBytes: null, descendants: none }), "rss")).toBe(
        "    vitest           3704700  fork worker                4m   10%     0m27s  300M    ?     nice 10",
      );
    });

    test("with descendants, a column is unknown when the worker's value or their sum is", () => {
      const descendants = { ...exampleProcess().descendants, swapBytes: null };
      expect(rowOf(exampleProcess({ cpuPct: null, swapBytes: 0, descendants }))).toBe(
        "    vitest           3704700  fork worker                4m     ?     0m29s  310M    ?     nice 10, +2 children",
      );
    });
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
        exampleRepository("/r/.git", false, [exampleDaemon({ processes: [process] })]),
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
