import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { HostCpu, TreeCpu } from "../../../src/core/capacity/cores.js";
import { clearMark, readMarks, writeMark } from "../../../src/core/capacity/marks.js";
import { createPermitPool, poolPermitFile } from "../../../src/core/capacity/pool.js";
import {
  type AdmitAsk,
  createHostAdmission,
  type HostAdmission,
  UNGRANTED,
} from "../../../src/core/runner-host/remote/admission.js";
import { TierCapacity, WAIT_FOR_CAPACITY } from "../../../src/core/scheduler/capacity.js";
import { TierPermits } from "../../../src/core/scheduler/local-permits.js";
import { takePermit } from "../../../src/core/slow/slot.js";
import type { LocalPermits, RunOptions } from "../../../src/core/types/runner.js";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup, until } from "./lane-fixture.js";

/** Row 026-23: set, every runner host counts as gone, as when its close cut a run short. */
const hostGone = vi.hoisted(() => ({ forced: false }));
vi.mock("../../../src/core/runner-host/proxy.js", async (actual) => {
  const real = await actual<typeof import("../../../src/core/runner-host/proxy.js")>();
  return {
    ...real,
    runnerHostGone: (adapter: Parameters<typeof real.runnerHostGone>[0]) =>
      hostGone.forced || real.runnerHostGone(adapter),
  };
});

/*
 * Spec 021 D18, last bullet (row 021-21; the coordinator, request
 * 66d23a73): a remote run counts against the remote machine. The lane gives
 * the run's local permits back, then waits for the remote machine's
 * admission under that machine's ceiling and floor; a cancel ends the wait
 * at once, and a run that comes back to run here waits for local permits
 * again. The remote machine has 24 CPUs and 23 slots: its ceiling is 18.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-lane-admission-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const closing: { close(): void }[] = [];
afterEach(() => {
  for (const item of closing.splice(0)) item.close();
});

let n = 0;
function poolDir(name: string): string {
  const dir = join(scratch, `${name}-${++n}`, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const tree: TreeCpu = { read: () => 0, reset() {} };
const busy = (cores: number): HostCpu => ({ read: () => cores });
const REFUSAL =
  "remote box: on its machine, the background ceiling refused a backlog tier: 20 busy CPUs, ceiling 18 (0.75 of 24 CPUs)";

/** The remote machine's admission over a pool in `dir`, its host at 20 of 24 CPUs busy. */
function remoteAdmissionIn(dir: string): HostAdmission {
  const made = createHostAdmission((log) =>
    createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "runner-host:/remote/tree" },
      hostSlots: 23,
      // 64 CPUs on any machine: the ceiling, 48, stays above the slots, so they bind (row 011-404).
      cpus: 24,
      cores: tree,
      host: busy(20),
      log,
    }),
  );
  closing.push(made);
  return made;
}

/** Another daemon on the remote machine runs a background tier. */
const backgroundThere = (dir: string) =>
  writeMark(dir, { id: "there", want: 1, grant: 1, since: null, cores: 1, background: 1 });

/** The permits another process could take in `dir` now. */
function free(dir: string, slots: number): number {
  const probe = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: `probe-${++n}` },
    hostSlots: slots,
    cores: null,
  });
  const grant = probe.acquire(slots, "fast", 1, "checkpoint")?.grant ?? 0;
  probe.close();
  return grant;
}

/** How many of the `slots` permit files in `dir` a holder locks now. */
function held(dir: string, slots: number): number {
  let count = 0;
  for (let i = 0; i < slots; i++) {
    const db = takePermit(join(dir, poolPermitFile(i)), {
      pid: process.pid,
      worktreeId: "counter",
    });
    if (db === null) count++;
    else db.close();
  }
  return count;
}

/** A background tier's local grant of all 4 permits of the pool in `dir`, as `executeTier` passes it. */
function localTier(dir: string, recheckMs = 20): TierPermits {
  const capacity = new TierCapacity(
    { dir, hostSlots: 4, host: null, cpus: 64 },
    `local-${++n}`,
    () => {},
  );
  closing.push(capacity);
  const lease = capacity.take(4, "fast", 1, "backlog");
  if (lease === null || lease === WAIT_FOR_CAPACITY) throw new Error("no local grant");
  return new TierPermits(capacity, lease, 1, recheckMs);
}

describe("a remote lane under the remote machine's own ceiling (spec 021 D18, row 021-21)", () => {
  it("gives the local permits back before it waits for the remote machine, and runs at the remote grant", async () => {
    const events: string[] = [];
    let looks = 0;
    const admission: HostAdmission = {
      admit: (ask: AdmitAsk) => {
        events.push(`admit ${ask.want}`);
        return ++looks < 3 ? { grant: 0 } : { grant: ask.want };
      },
      // A grant without a pool behind it: the run goes ungranted.
      claim: () => UNGRANTED,
      close: () => {},
    };
    const permits: LocalPermits = {
      away: () => events.push("away"),
      back: async () => {
        events.push("back");
        return 2;
      },
    };
    const { lane, remoteRuns, localRuns } = await setup({
      admission,
      admitEveryMs: 5,
      remoteRun: async (_root, _hang, options) => {
        events.push(`run at ${options.workers}${"permits" in options ? " with permits" : ""}`);
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const report = await lane.run([REF], background({ permits, workers: 4 }));
    expect(report.completedFiles).toEqual([REF]);
    expect(remoteRuns).toHaveLength(1);
    expect(localRuns).toHaveLength(0);
    // Four workers granted here; one file wanted there, and the run takes the remote grant.
    expect(events).toEqual(["away", "admit 1", "admit 1", "admit 1", "run at 1"]);
  });

  it("holds no local permit while the remote is above its ceiling, logs the refusal with its busy CPUs, and the floor lets it through", async () => {
    const remote = poolDir("remote");
    const here = poolDir("here");
    backgroundThere(remote);
    const permits = localTier(here);
    expect(free(here, 4)).toBe(0);
    const during: number[] = [];
    const { lane, remoteRuns, logs } = await setup({
      admission: remoteAdmissionIn(remote),
      admitEveryMs: 20,
      remoteRun: async (_root, _hang, options) => {
        during.push(free(here, 4), held(remote, 23), options.workers ?? -1);
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const running = lane.run([REF], background({ permits, workers: 4 }));
    await until(() => logs.includes(REFUSAL));
    // Later looks of the same wait log no more refusal lines (row 011-404).
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(logs.filter((line) => line === REFUSAL)).toHaveLength(1);
    // The run waits there and holds nothing here: this machine's background tiers may run.
    expect(remoteRuns).toHaveLength(0);
    expect(free(here, 4)).toBe(4);
    // No other background run on the remote machine: its floor admits this one, one worker wide.
    clearMark(remote, "there");
    const report = await running;
    expect(report.completedFiles).toEqual([REF]);
    expect(during).toEqual([4, 1, 1]);
    expect(held(remote, 23)).toBe(0);
    permits.release();
    expect(free(here, 4)).toBe(4);
  });

  it("ends at once on a cancel during the admission wait, with no file run and no permit held on either machine", async () => {
    const remote = poolDir("remote");
    const here = poolDir("here");
    backgroundThere(remote);
    const permits = localTier(here);
    const { lane, remoteRuns, localRuns, logs } = await setup({
      admission: remoteAdmissionIn(remote),
      admitEveryMs: 60_000,
    });
    const cancel = new AbortController();
    const running = lane.run([REF], background({ permits, workers: 4, signal: cancel.signal }));
    await until(() => logs.includes(REFUSAL));
    const at = Date.now();
    cancel.abort("edit");
    const report = await running;
    expect(Date.now() - at).toBeLessThan(1_000);
    // Ended with no file completed, as a cancelled run: the scheduler queues the file again.
    expect(report).toMatchObject({ end: "completed", completedFiles: [], results: [] });
    expect(remoteRuns).toHaveLength(0);
    expect(localRuns).toHaveLength(0);
    expect(free(here, 4)).toBe(4);
    // The remote pool holds no permit; its look stays a waiter's until it is forgotten (30 s).
    const marks = readMarks(remote, "reader", Date.now());
    expect(marks.find((mark) => mark.id === "runner-host:/remote/tree")).toMatchObject({
      grant: 0,
    });
    expect(held(remote, 23)).toBe(0);
    permits.release();
    expect(free(here, 4)).toBe(4);
  });

  it("waits for local permits again before a run lost on the remote runs here", async () => {
    const here = poolDir("here");
    const permits = localTier(here);
    const holder = createPermitPool({
      dir: here,
      owner: { pid: process.pid, worktreeId: "holder" },
      hostSlots: 4,
      cores: null,
    });
    closing.push(holder);
    const taken: { lease: { release(): void; readonly grant: number } | null } = { lease: null };
    const { lane, localRuns } = await setup({
      remoteRun: async (_root, _hang, _options, kill) => {
        // Another daemon takes every local permit the run gave back; then the remote is lost.
        taken.lease = holder.acquire(4, "fast", 1, "checkpoint");
        kill();
        return new Promise<never>(() => {});
      },
    });
    const running = lane.run([REF], background({ permits, workers: 4 }));
    await until(() => taken.lease !== null);
    expect(taken.lease?.grant).toBe(4);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(localRuns).toHaveLength(0);
    taken.lease?.release();
    const report = await running;
    expect(report.completedFiles).toEqual([REF]);
    expect(localRuns).toHaveLength(1);
    const [ran] = localRuns as [RunOptions];
    expect(ran.logDir.endsWith("/here")).toBe(true);
    expect(ran.workers).toBeGreaterThanOrEqual(1);
    expect(ran.workers).toBeLessThanOrEqual(4);
    expect("permits" in ran).toBe(false);
    // It holds what it took again until the tier ends.
    expect(free(here, 4)).toBe(4 - (ran.workers ?? 0));
    permits.release();
    expect(free(here, 4)).toBe(4);
  });
});

/*
 * Row 026-23: concurrent tiers on one remote host, as `node:test`'s backlog
 * slots send them. Each attempt holds its grant under its own token; a host
 * lost under several runs goes down once, with the first reason; a run the
 * host's close cut short is lost, never completed.
 */
describe("concurrent remote tiers on one host (row 026-23)", () => {
  /** The remote machine's admission at 2 of 24 CPUs busy; grants wait until `slots` attempts asked. */
  function gatedAdmission(slots: number) {
    const real = createHostAdmission((log) =>
      createPermitPool({
        dir: poolDir("remote"),
        owner: { pid: process.pid, worktreeId: "runner-host:/remote/tree" },
        hostSlots: 23,
        cpus: 24,
        cores: tree,
        host: busy(2),
        log,
      }),
    );
    closing.push(real);
    const asked = new Set<string | undefined>();
    const held = new Set<string | undefined>();
    let most = 0;
    const admission: HostAdmission = {
      admit: (ask) => {
        asked.add(ask.token);
        if (ask.want > 0 && asked.size < slots) return { grant: 0 };
        const answer = real.admit(ask);
        if (answer.grant > 0) held.add(ask.token);
        most = Math.max(most, held.size);
        return answer;
      },
      claim: (token) => {
        held.delete(token);
        return real.claim(token);
      },
      close: () => real.close(),
    };
    return { admission, most: () => most };
  }

  it("runs four concurrent tiers there, each on its own grant, with none unadmitted and no host closed", async () => {
    const gate = gatedAdmission(4);
    const s = await setup({
      admission: gate.admission,
      admitEveryMs: 3,
      remoteRun: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const runs = [0, 1, 2, 3].map(async (i) => {
      await new Promise((resolve) => setTimeout(resolve, i * 4));
      return s.lane.run([REF], background());
    });
    const reports = await Promise.all(runs);
    for (const report of reports) expect(report.completedFiles).toEqual([REF]);
    expect(s.remoteRuns).toHaveLength(4);
    expect(s.localRuns).toHaveLength(0);
    // Grants were held side by side: the race the tokens settle was there.
    expect(gate.most()).toBeGreaterThanOrEqual(2);
    expect(s.logs.filter((line) => /grant went back/.test(line))).toEqual([]);
    expect(s.events).toEqual(["connect"]);
    expect(s.lane.report()).toMatchObject({ state: "ready" });
  });

  it("goes down once, with the first reason, when a host is lost under three runs", async () => {
    let started = 0;
    const s = await setup({
      whenLost: "not-run",
      deadlines: { aliveMs: 300 },
      remoteRun: (_root, hang) => {
        if (++started === 3) hang();
        return new Promise(() => {});
      },
    });
    const reports = await Promise.all([0, 1, 2].map(() => s.lane.run([REF], background())));
    for (const report of reports) {
      expect(report.end).not.toBe("completed");
      expect(report.completedFiles).toEqual([]);
    }
    const reason =
      "the vitest runner host did not answer run, nor tell it is alive, within 300 ms; Squeal stopped it";
    const downs = s.logs.filter((line) => line.startsWith("remote box: the vitest runner host"));
    expect(downs).toEqual([`remote box: ${reason}`]);
    expect(s.lane.report()).toEqual({ state: "unreachable", reason });
    expect(s.localRuns).toHaveLength(0);
  });

  it("keeps the first reason when a sibling run ends on the host another run took down", async () => {
    let victim = "";
    let claims = 0;
    let end = () => {};
    const admission: HostAdmission = {
      admit: () => ({ grant: 1 }),
      // Every run of the victim's tier comes after its grant went back: the third takes the host down.
      claim: (token) => {
        if (token?.startsWith(`${victim}:`) !== true) return UNGRANTED;
        // As `node:test` does when its host closes: the sibling ends with no file and no failure.
        if (++claims === 3) end();
        return null;
      },
      close: () => {},
    };
    const s = await setup({
      whenLost: "not-run",
      admission,
      remoteRun: () =>
        new Promise((resolve) => {
          end = () => resolve({ ...REPORT });
        }),
    });
    const sibling = s.lane.run([REF], background());
    await until(() => s.remoteRuns.length === 1);
    const lateRun = background();
    victim = lateRun.runId;
    const late = await s.lane.run([REF], lateRun);
    expect(late.end).toBe("crashed");
    const cut = await sibling;
    expect(cut.end).toBe("crashed");
    expect(cut.completedFiles).toEqual([]);
    // The host's exit under the sibling names no new reason: the first one stands.
    expect(s.lane.report()).toEqual({
      state: "unreachable",
      reason: "its machine's grant went back before the run came, 3 times",
    });
  });

  it("reports a run whose host is gone when its reply comes as lost, though the reply says completed", async () => {
    const s = await setup({
      whenLost: "not-run",
      remoteRun: async () => {
        // The host's close cut the run short: `node:test` ends with no file and no failure.
        hostGone.forced = true;
        return { ...REPORT };
      },
    });
    try {
      const report = await s.lane.run([REF], background());
      expect(report.end).toBe("crashed");
      expect(report.completedFiles).toEqual([]);
      expect(report.failure).toBe("remote box unreachable during the run of 1 files");
      expect(s.lane.report()).toEqual({ state: "unreachable", reason: "the host ended" });
    } finally {
      hostGone.forced = false;
    }
  });
});
