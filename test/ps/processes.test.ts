import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ProcessOwner } from "../../src/core/ps/model.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import { attribute, parseMark } from "../../src/core/ps/processes.js";
import type { PsTier } from "../../src/core/ps/shape.js";
import { ALPHA_MARK, BETA_MARK, writeTree } from "./fixture.js";
import { type FakeProcess, fakeSource, tableOf } from "./fixture-samples.js";

/*
 * Spec 014 D5 (task 014-07): which daemon each test process is of, its
 * lane, runner and files, and its descendants. A process's owner is its
 * nearest daemon ancestor, else the daemon whose token its mark carries.
 */

const TOKEN = "6500d1d2-7ae8-4039-a08e-1b231205f5c8";
const OTHER = "81287f79-65c7-4cd3-b2cb-547bba728456";
const NODE = "/usr/bin/node";
const FORKS = "/home/user/projects/beta/node_modules/vitest/dist/workers/forks.js";
const DAEMON = 2091490;
// The argument a node:test process names its file after. This file runs no node:test: the
// literal is built so the version-sensitive rule (spec 010 D4) does not read it as one that does.
const TEST_FLAG = `--${"test"}`;

const tier = (runId: string, lane: string | null): PsTier => ({
  runId,
  lane,
  files: 200,
  startedAt: 1_792_599_000_000,
  checkpointId: null,
});
const owner = (pid: number, token: string | null, tiers: readonly PsTier[] = []): ProcessOwner => ({
  pid,
  token,
  tiers,
});

const daemon: FakeProcess = { pid: DAEMON, ppid: 1049, comm: "MainThread" };
const forkWorker = {
  pid: 2353452,
  ppid: DAEMON,
  cmdline: [NODE, "--experimental-import-meta-resolve", FORKS],
  mark: `${TOKEN}:vitest`,
} satisfies FakeProcess;

function run(
  processes: readonly FakeProcess[],
  owners: readonly ProcessOwner[],
  readsMarks = true,
) {
  const { source, reads } = fakeSource(processes, { readsMarks });
  return { ...attribute(source, tableOf(processes), owners), reads };
}

describe("owner", () => {
  test("the nearest daemon ancestor owns a marked process, its lane is the mark after the token, and a fork worker's files are its tier's", () => {
    const { processes, unowned } = run([daemon, forkWorker], [owner(DAEMON, TOKEN)]);
    expect(processes).toEqual([
      {
        pid: 2353452,
        daemonPid: DAEMON,
        escaped: false,
        lane: "vitest",
        runId: null,
        runner: "vitest",
        files: null,
        descendants: [],
      },
    ]);
    expect(unowned).toEqual([]);
  });

  test("ancestry wins over the token: a nested daemon owns its own workers, whatever mark it inherited", () => {
    const inner: FakeProcess = {
      pid: 500,
      ppid: forkWorker.pid,
      comm: "MainThread",
      mark: `${TOKEN}:vitest`,
    };
    const innerWorker: FakeProcess = {
      pid: 501,
      ppid: 500,
      cmdline: [NODE, FORKS],
      mark: `${OTHER}:vitest`,
    };
    const { processes } = run(
      [daemon, forkWorker, inner, innerWorker],
      [owner(DAEMON, TOKEN), owner(500, OTHER)],
    );
    expect(processes.map((p) => [p.pid, p.daemonPid, p.descendants])).toEqual([
      [501, 500, []],
      [2353452, DAEMON, []],
    ]);
  });

  test("an escaped process, with no daemon ancestor, is owned by its mark's token", () => {
    const chrome: FakeProcess = {
      pid: 2242955,
      ppid: 1049,
      comm: "chrome",
      cmdline: ["/usr/bin/google-chrome", "--no-first-run"],
      mark: `${TOKEN}:slow:vitest`,
    };
    const { processes, unowned } = run([daemon, chrome], [owner(DAEMON, TOKEN)]);
    expect(processes).toEqual([
      {
        pid: 2242955,
        daemonPid: DAEMON,
        escaped: true,
        lane: "slow:vitest",
        runId: null,
        runner: null,
        files: null,
        descendants: [],
      },
    ]);
    expect(unowned).toEqual([]);
  });

  test("a mark no live daemon's token owns is unowned, each marked process of it, with the mark", () => {
    const left: FakeProcess = {
      pid: 900,
      ppid: 1049,
      comm: "chrome",
      mark: `${OTHER}:slow:vitest`,
    };
    const crashpad: FakeProcess = {
      pid: 901,
      ppid: 900,
      comm: "chrome_crashpad",
      mark: `${OTHER}:slow:vitest`,
    };
    const cat: FakeProcess = { pid: 902, ppid: 900, comm: "cat" };
    const { processes, unowned } = run([daemon, left, crashpad, cat], [owner(DAEMON, TOKEN)]);
    expect(processes).toEqual([]);
    expect(unowned).toEqual([
      { pid: 900, mark: `${OTHER}:slow:vitest` },
      { pid: 901, mark: `${OTHER}:slow:vitest` },
    ]);
    // With no daemon alive at all, every mark is unowned.
    expect(run([left], []).unowned).toEqual([{ pid: 900, mark: `${OTHER}:slow:vitest` }]);
  });

  test("while a live daemon's token is unread, an unmatched mark may be its own: neither attributed nor unowned", () => {
    const left: FakeProcess = { pid: 900, ppid: 1049, mark: `${OTHER}:vitest` };
    const { processes, unowned } = run([daemon, left], [owner(DAEMON, null)]);
    expect(processes).toEqual([]);
    expect(unowned).toEqual([]);
  });

  test("a daemon's own unmarked child is no test process", () => {
    const git: FakeProcess = { pid: 600, ppid: DAEMON, comm: "git", cmdline: ["git", "status"] };
    expect(run([daemon, git], [owner(DAEMON, TOKEN)]).processes).toEqual([]);
  });
});

describe("lane and run", () => {
  // A tier's lane is the store's class, `fast`, `slow` or `null` (the coordinator, 2026-10-21).
  const runIdOf = (mark: string, tiers: readonly PsTier[]): string | null | undefined =>
    run([daemon, { ...forkWorker, mark }], [owner(DAEMON, TOKEN, tiers)]).processes[0]?.runId;

  test("(a) the run is the mark's #<runId> first, whatever tiers are open", () => {
    const tiers = [tier("run-a", "fast"), tier("run-s", "slow")];
    expect(runIdOf(`${TOKEN}:vitest#run-b`, tiers)).toBe("run-b");
  });

  test("(b) else the daemon's one open tier of the mark's class: slow for a `slow:` lane, fast for any other or none", () => {
    const tiers = [tier("run-f", "fast"), tier("run-s", "slow"), tier("run-n", null)];
    expect(runIdOf(`${TOKEN}:slow:vitest`, tiers)).toBe("run-s");
    expect(runIdOf(`${TOKEN}:vitest`, tiers)).toBe("run-f");
    expect(runIdOf(`${TOKEN}:`, tiers)).toBe("run-f");
    expect(runIdOf(TOKEN, tiers)).toBe("run-f");
    // The process keeps the mark's own lane.
    const slow = run(
      [daemon, { ...forkWorker, mark: `${TOKEN}:slow:vitest` }],
      [owner(DAEMON, TOKEN, tiers)],
    ).processes[0];
    expect(slow?.lane).toBe("slow:vitest");
  });

  test("(b) two open tiers of its class, and no `#`: which one it serves is the daemon's to know", () => {
    expect(runIdOf(`${TOKEN}:vitest`, [tier("run-a", "fast"), tier("run-b", "fast")])).toBeNull();
    expect(
      runIdOf(`${TOKEN}:vitest`, [
        tier("run-a", "fast"),
        tier("run-b", "fast"),
        tier("run-n", null),
      ]),
    ).toBeNull();
  });

  test("(c) else the daemon's one open tier, when the store cannot tell its class", () => {
    expect(runIdOf(`${TOKEN}:slow:vitest`, [tier("run-n", null)])).toBe("run-n");
    expect(runIdOf(`${TOKEN}:vitest`, [tier("run-n", null)])).toBe("run-n");
  });

  test("(d) else none: no tier of its class, and no lone tier of unknown class", () => {
    expect(runIdOf(`${TOKEN}:vitest`, [])).toBeNull();
    expect(runIdOf(`${TOKEN}:vitest`, [tier("run-s", "slow")])).toBeNull();
    expect(runIdOf(`${TOKEN}:vitest`, [tier("run-s", "slow"), tier("run-n", null)])).toBeNull();
    expect(runIdOf(`${TOKEN}:slow:vitest`, [tier("run-n", null), tier("run-m", null)])).toBeNull();
  });

  test("parseMark reads `<token>`, `<token>:<lane>` and `<token>:<lane>#<runId>`; an empty lane is none", () => {
    expect(parseMark(TOKEN)).toEqual({ token: TOKEN, lane: null, runId: null });
    expect(parseMark(`${TOKEN}:`)).toEqual({ token: TOKEN, lane: null, runId: null });
    expect(parseMark(`${TOKEN}:slow:vitest`)).toEqual({
      token: TOKEN,
      lane: "slow:vitest",
      runId: null,
    });
    expect(parseMark(`${TOKEN}:vitest#r1`)).toEqual({ token: TOKEN, lane: "vitest", runId: "r1" });
  });
});

describe("runner and files", () => {
  test("a node:test process names its file after --test and its reporter options", () => {
    const testRun: FakeProcess = {
      pid: 700,
      ppid: DAEMON,
      cmdline: [
        NODE,
        "--enable-source-maps",
        "--require",
        "/home/user/.claude/plugins/cache/hearsay/squeal/0.1.235/dist/observe/recorder.cjs",
        TEST_FLAG,
        "--test-reporter=/home/user/r.mjs",
        "--test-reporter-destination=/tmp/squeal-1000/logs/events-0.ndjson",
        "test/a.test.mjs",
      ],
      mark: `${TOKEN}:node-test`,
    };
    expect(run([daemon, testRun], [owner(DAEMON, TOKEN)]).processes[0]).toMatchObject({
      runner: "node-test",
      files: ["test/a.test.mjs"],
    });
  });

  test("a pytest batch names its files after --basetemp=<dir>", () => {
    const pytest: FakeProcess = {
      pid: 701,
      ppid: DAEMON,
      comm: "python3",
      cmdline: [
        "/usr/bin/python3",
        "-m",
        "pytest",
        "-p",
        "squeal_pytest",
        "--basetemp=/tmp/squeal-pytest/x/0",
        "tests/test_a.py",
        "tests/test_b.py",
      ],
      mark: `${TOKEN}:pytest`,
    };
    expect(run([daemon, pytest], [owner(DAEMON, TOKEN)]).processes[0]).toMatchObject({
      runner: "pytest",
      files: ["tests/test_a.py", "tests/test_b.py"],
    });
  });

  test("a process that left before its command line was read has no runner and no files", () => {
    const gone = { ...forkWorker, cmdline: null };
    expect(run([daemon, gone], [owner(DAEMON, TOKEN)]).processes[0]).toMatchObject({
      runner: null,
      files: null,
    });
  });
});

describe("descendants", () => {
  test("a test process's descendants without a mark of their own, and those that inherited one, are summed into it", () => {
    const git: FakeProcess = { pid: 2353500, ppid: forkWorker.pid, comm: "git" };
    const server: FakeProcess = { pid: 2353510, ppid: forkWorker.pid, mark: forkWorker.mark };
    const grandchild: FakeProcess = { pid: 2353520, ppid: 2353510, comm: "sh" };
    const { processes, reads } = run(
      [daemon, forkWorker, git, server, grandchild],
      [owner(DAEMON, TOKEN)],
    );
    expect(processes.map((p) => [p.pid, p.descendants])).toEqual([
      [forkWorker.pid, [2353500, 2353510, 2353520]],
    ]);
    // Command lines of the test processes only.
    expect(reads.get("cmdline")).toBe(1);
  });

  test("an escaped process's own children are its descendants", () => {
    const chrome = {
      pid: 900,
      ppid: 1049,
      comm: "chrome",
      mark: `${TOKEN}:slow:vitest`,
    } satisfies FakeProcess;
    const crashpad: FakeProcess = {
      pid: 901,
      ppid: 900,
      comm: "chrome_crashpad",
      mark: chrome.mark,
    };
    const { processes } = run([daemon, chrome, crashpad], [owner(DAEMON, TOKEN)]);
    expect(processes.map((p) => [p.pid, p.escaped, p.descendants])).toEqual([[900, true, [901]]]);
  });
});

describe("a source that reads no marks (D10)", () => {
  test("by the ppid tree only: the daemon's children are its test processes, with no lane; nothing escapes or is unowned", () => {
    const git: FakeProcess = { pid: 2353500, ppid: forkWorker.pid, comm: "git" };
    const chrome: FakeProcess = { pid: 900, ppid: 1049, comm: "chrome", mark: `${TOKEN}:vitest` };
    const { processes, unowned, reads } = run(
      [daemon, forkWorker, git, chrome],
      [owner(DAEMON, TOKEN)],
      false,
    );
    expect(processes).toEqual([
      {
        pid: forkWorker.pid,
        daemonPid: DAEMON,
        escaped: false,
        lane: null,
        runId: null,
        runner: "vitest",
        files: null,
        descendants: [2353500],
      },
    ]);
    expect(unowned).toEqual([]);
    expect(reads.get("environ") ?? 0).toBe(0);
  });
});

describe("over the Linux source's fixture tree", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "squeal-ps-processes-"));
    writeTree(root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("the fork worker, its git, and the escaped Chrome; no environment value but the mark leaves markOf", () => {
    const source = createProcSource({ root });
    const alphaToken = ALPHA_MARK.split(":")[0] ?? "";
    const betaToken = BETA_MARK.split(":")[0] ?? "";
    const attribution = attribute(source, source.processTable(), [
      owner(349493, alphaToken),
      owner(DAEMON, betaToken),
    ]);
    expect(
      attribution.processes.map((p) => [p.pid, p.daemonPid, p.escaped, p.lane, p.descendants]),
    ).toEqual([
      [2242955, 349493, true, "slow:vitest", []],
      [2353452, DAEMON, false, "vitest", [2353500]],
    ]);
    const text = JSON.stringify(attribution);
    for (const value of ["do-not-print", "/usr/bin", "NODE_ENV", "VITEST", "GIT_DIR", "/tmp/x"])
      expect(text).not.toContain(value);
  });
});
