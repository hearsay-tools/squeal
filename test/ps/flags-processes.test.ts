import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import type { Attribution, FoundDaemon, TestProcessModel } from "../../src/core/ps/model.js";
import {
  claudeInstalled,
  foundDaemon,
  installScript,
  type ModelHost,
  type ModelSpec,
  makeRoot,
  modelHost,
  modelOf,
  startedAt,
  workOf,
} from "./fixture-model.js";

/*
 * Spec 014 D7, the processes: test processes past their bound, marks no
 * live daemon owns, waiters whose session is gone and permit holders that
 * are no daemon; each flagged and healthy, and what a source without marks
 * or locks leaves unevaluated (D10).
 */

let host: ModelHost;
let daemon: FoundDaemon;
beforeEach(() => {
  host = modelHost();
  claudeInstalled(host.places.home, "0.1.235");
  const { root, commonDir } = makeRoot(host, "alpha");
  const script = installScript(host.places.home, "claude", "0.1.235");
  daemon = foundDaemon({ pid: 4100, root, commonDir, script, ageS: 7200 });
});
afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

const MARK = "token-4100:vitest";

function model(spec: Omit<ModelSpec, "host">) {
  return modelOf({ host, daemons: [{ daemon, first: workOf(daemon) }], ...spec });
}

function testProcess(over: Partial<TestProcessModel> = {}): TestProcessModel {
  return {
    pid: 5000,
    daemonPid: 4100,
    escaped: false,
    lane: "vitest",
    runId: null,
    runner: "vitest",
    files: null,
    descendants: [],
    ...over,
  };
}

const attributed = (...processes: TestProcessModel[]): Attribution => ({ processes, unowned: [] });

describe("overdue-test-process", () => {
  it("flags an escaped carrier, and a marked descendant, older than runner.timeoutMs plus 60 s", () => {
    const findings = flag(
      model({
        processes: [
          { pid: 5000, ppid: 1, ageS: 661, mark: MARK },
          { pid: 6000, ppid: 4100, ageS: 900, mark: MARK },
          { pid: 6001, ppid: 6000, comm: "chrome", ageS: 700, mark: MARK },
        ],
        attribution: attributed(
          testProcess({ escaped: true }),
          testProcess({ pid: 6000, descendants: [6001] }),
        ),
      }),
    );
    expect(findings.processes.get(5000)).toEqual([
      {
        flag: "overdue-test-process",
        reason: "it is 11m old, past runner.timeoutMs plus 60 s",
        command: "kill 5000",
      },
    ]);
    expect(findings.processes.get(6000)).toEqual([
      {
        flag: "overdue-test-process",
        reason:
          "its descendant 6001 (chrome) carries its mark, is not its daemon's child, and is 11m old, past runner.timeoutMs plus 60 s",
        command: "kill 6001",
      },
    ]);
  });

  it("leaves the daemon's own child, a young carrier and an unmarked descendant alone", () => {
    const findings = flag(
      model({
        processes: [
          { pid: 5000, ppid: 4100, ageS: 3_600, mark: MARK },
          { pid: 5001, ppid: 1, ageS: 659, mark: MARK },
          { pid: 5002, ppid: 5000, ageS: 3_600 },
        ],
        attribution: attributed(
          testProcess({ descendants: [5002] }),
          testProcess({ pid: 5001, escaped: true }),
        ),
      }),
    );
    expect(findings.processes.size).toBe(0);
  });
});

describe("orphan-test-process", () => {
  const unowned = { processes: [], unowned: [{ pid: 7000, mark: "dead-token:slow:vitest" }] };
  const orphan = { pid: 7000, ppid: 1, comm: "node", ageS: 120, mark: "dead-token:slow:vitest" };

  it("flags a mark no live daemon owns on both samples a second apart", () => {
    const findings = flag(model({ processes: [orphan], attribution: unowned }));
    expect(findings.orphans).toEqual([
      {
        pid: 7000,
        comm: "node",
        startedAt: startedAt(120),
        flags: [
          {
            flag: "orphan-test-process",
            reason: "its mark's token dead-token names no live daemon, on both samples",
            command: "kill 7000",
          },
        ],
      },
    ]);
  });

  it("claims none seen once, gone by the second sample, or on samples under 1 s apart", () => {
    const once = { processes: [], unowned: [] };
    expect(
      flag(model({ processes: [orphan], attribution: unowned, secondAttribution: once })).orphans,
    ).toEqual([]);
    expect(
      flag(model({ processes: [orphan], attribution: unowned, goneBySecond: [7000] })).orphans,
    ).toEqual([]);
    const quick = flag(model({ processes: [orphan], attribution: unowned, windowMs: 900 }));
    expect(quick.orphans).toEqual([]);
    expect(quick.unknown).toContainEqual({
      what: "flag orphan-test-process",
      why: "the samples are 900 ms apart, under 1 s",
    });
  });

  it("claims none while a daemon's token is unread, and names it", () => {
    const unread = workOf(daemon, { token: null });
    const findings = flag(
      modelOf({
        host,
        daemons: [{ daemon, first: unread }],
        processes: [orphan],
        attribution: unowned,
      }),
    );
    expect(findings.orphans).toEqual([]);
    expect(findings.unknown).toContainEqual({
      what: "flag orphan-test-process",
      why: "the token of daemon 4100 is unread, so a mark may be its",
    });
  });
});

describe("orphan-waiter", () => {
  const waiter = (pid: number, ppid: number) => ({
    pid,
    ppid,
    comm: "MainThread",
    cmdline: ["node", "/home/user/.claude/plugins/cache/hearsay/squeal/0.1.235/dist/waiter.mjs"],
  });

  it("flags a waiter whose parent is gone or is systemd", () => {
    const findings = flag(
      model({ processes: [waiter(8000, 999), waiter(8001, 1700), { pid: 1700, comm: "systemd" }] }),
    );
    expect(findings.orphans.map((o) => [o.pid, o.flags.map((f) => f.reason)])).toEqual([
      [8000, ["its parent 999 is gone"]],
      [8001, ["its parent is systemd 1700: its session is gone"]],
    ]);
  });

  it("leaves a waiter whose session is alive alone", () => {
    const findings = flag(
      model({ processes: [waiter(8000, 3212240), { pid: 3212240, comm: "claude" }] }),
    );
    expect(findings.orphans).toEqual([]);
  });
});

describe("foreign-permit", () => {
  it("flags a permit holder that is no daemon, and leaves the daemons' permits alone", () => {
    const path = `${host.places.runtimeDir}/squeal/pool.3.lock`;
    const findings = flag(
      model({
        processes: [{ pid: 9000, comm: "python3", ageS: 60 }],
        pool: { permits: new Map([[4100, 2]]), foreign: [{ pid: 9000, path }] },
      }),
    );
    expect(findings.orphans).toEqual([
      {
        pid: 9000,
        comm: "python3",
        startedAt: startedAt(60),
        flags: [
          {
            flag: "foreign-permit",
            reason: `it holds the pool permit ${path} and is no daemon`,
            command: "kill 9000",
          },
        ],
      },
    ]);
    expect(findings.daemons.get(4100)).toEqual([]);
  });
});

describe("a source without marks (D10)", () => {
  it("names the orphan and overdue rules unknown and claims neither", () => {
    const findings = flag(
      model({
        readsMarks: false,
        processes: [{ pid: 5000, ppid: 1, ageS: 7_000 }],
        attribution: {
          processes: [testProcess({ escaped: true })],
          unowned: [{ pid: 5000, mark: "x" }],
        },
      }),
    );
    expect(findings.processes.size).toBe(0);
    expect(findings.orphans).toEqual([]);
    const why = "the source reads no marks (D10)";
    expect(findings.unknown).toEqual(
      expect.arrayContaining([
        { what: "flag orphan-test-process", why },
        { what: "flag overdue-test-process", why },
      ]),
    );
  });
});
