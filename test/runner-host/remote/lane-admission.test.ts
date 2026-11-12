import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { HostCpu, TreeCpu } from "../../../src/core/capacity/cores.js";
import { clearMark, readMarks, writeMark } from "../../../src/core/capacity/marks.js";
import { createPermitPool, poolPermitFile } from "../../../src/core/capacity/pool.js";
import {
  type AdmitAsk,
  createHostAdmission,
  type HostAdmission,
} from "../../../src/core/runner-host/remote/admission.js";
import { TierCapacity, WAIT_FOR_CAPACITY } from "../../../src/core/scheduler/capacity.js";
import { TierPermits } from "../../../src/core/scheduler/local-permits.js";
import { takePermit } from "../../../src/core/slow/slot.js";
import type { LocalPermits, RunOptions } from "../../../src/core/types/runner.js";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup, until } from "./lane-fixture.js";

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
  const capacity = new TierCapacity({ dir, hostSlots: 4, host: null }, `local-${++n}`, () => {});
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
      claim: () => null,
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
    await until(() => logs.filter((line) => line === REFUSAL).length >= 2);
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
    let held: { release(): void } | null = null;
    const { lane, localRuns } = await setup({
      remoteRun: async (_root, _hang, _options, kill) => {
        // Another daemon takes every local permit the run gave back; then the remote is lost.
        held = holder.acquire(4, "fast", 1, "checkpoint");
        kill();
        return new Promise<never>(() => {});
      },
    });
    const running = lane.run([REF], background({ permits, workers: 4 }));
    await until(() => held !== null);
    expect(held).toMatchObject({ grant: 4 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(localRuns).toHaveLength(0);
    held?.release();
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
