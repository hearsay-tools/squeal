import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { HostCpu, TreeCpu } from "../../../src/core/capacity/cores.js";
import { clearMark, writeMark } from "../../../src/core/capacity/marks.js";
import { createPermitPool, poolPermitFile } from "../../../src/core/capacity/pool.js";
import {
  type AdmitAnswer,
  type AdmitAsk,
  createHostAdmission,
  type HostAdmission,
  machinePool,
  remoteAdmission,
} from "../../../src/core/runner-host/remote/admission.js";

/*
 * Spec 021 D18, last bullet (row 021-21): a remote runner host admits the
 * daemon's background runs under its own machine's ceiling, with the pool
 * its user's daemons share there: refused while the busy CPUs are at the
 * ceiling and another background tier runs, the floor's one run while none
 * does. The machine here has 24 CPUs and 23 slots: the default ceiling is 18.
 */

let root: string;
let dir: string;
const closing: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-admission-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const item of closing.splice(0)) item.close();
  rmSync(root, { recursive: true, force: true });
});

const tree: TreeCpu = { read: () => 0, reset() {} };

/** A machine whose busy cores the test sets. */
function busy(cores: number): HostCpu & { cores: number } {
  return {
    cores,
    read() {
      return this.cores;
    },
  };
}

/** The remote machine's admission over a pool in `dir`, its host at `machine`. */
function admission(machine: HostCpu, holdMs?: number): HostAdmission {
  const made = createHostAdmission(
    (log) =>
      createPermitPool({
        dir,
        owner: { pid: process.pid, worktreeId: "runner-host:/remote/tree" },
        hostSlots: 23,
        cpus: 24,
        cores: tree,
        host: machine,
        log,
      }),
    holdMs,
  );
  closing.push(made);
  return made;
}

/** What another process could take now: a pool without a CPU gate. */
function free(slots = 23): number {
  const probe = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: `probe-${Math.random()}` },
    hostSlots: slots,
    cores: null,
  });
  const grant = probe.acquire(slots, "fast", 1, "checkpoint")?.grant ?? 0;
  probe.close();
  return grant;
}

/** Another daemon of the remote machine's user runs a background tier on one permit. */
function backgroundRunsThere(): void {
  writeMark(dir, { id: "there", want: 1, grant: 1, since: null, cores: 1, background: 1 });
}

describe("the remote machine's admission (spec 021 D18, row 021-21)", () => {
  test("refuses at its ceiling with the busy CPUs while another background tier runs, and the floor admits one run while none does", () => {
    backgroundRunsThere();
    const remote = admission(busy(20));
    expect(remote.admit({ want: 4, least: 1 })).toEqual({
      grant: 0,
      refusal:
        "the background ceiling refused a backlog tier: 20 busy CPUs, ceiling 18 (0.75 of 24 CPUs)",
    });
    expect(remote.claim()).toBeNull();
    clearMark(dir, "there");
    // No background tier runs on the machine: the floor gives the waiting run its fewest workers.
    expect(remote.admit({ want: 4, least: 1 })).toEqual({ grant: 1 });
    // Below the ceiling it gets what the ceiling leaves: 18 − 10 busy = 8, of 4 wanted.
    const quiet = admission(busy(10));
    remote.close();
    expect(quiet.admit({ want: 4, least: 1 })).toEqual({ grant: 4 });
  });

  test("holds a grant for the run that claims it; returns one left unclaimed, at the next look or after the hold", async () => {
    const remote = admission(busy(2), 50);
    expect(remote.admit({ want: 3, least: 1 }).grant).toBe(3);
    expect(free()).toBe(20);
    const lease = remote.claim();
    expect(lease?.grant).toBe(3);
    expect(remote.claim()).toBeNull();
    lease?.release();
    expect(free()).toBe(23);
    // A look for 0 workers returns the grant held and takes nothing.
    expect(remote.admit({ want: 5, least: 1 }).grant).toBe(5);
    expect(remote.admit({ want: 0, least: 0 })).toEqual({ grant: 0 });
    expect(free()).toBe(23);
    // A grant no run claims goes back after the hold.
    expect(remote.admit({ want: 2, least: 1 }).grant).toBe(2);
    expect(free()).toBe(21);
    await sleep(120);
    expect(free()).toBe(23);
    expect(remote.claim()).toBeNull();
  });

  test("a pool that fails admits the run without a grant and says why", () => {
    const remote = createHostAdmission(() => {
      throw new Error("capacity pool directory is not this user's");
    });
    expect(remote.admit({ want: 3, least: 1 })).toEqual({
      grant: 3,
      failed: "capacity pool directory is not this user's",
    });
    expect(remote.claim()).toBeNull();
  });

  test("the machine's pool is its user's: the slot directory and capacity settings of the remote user", () => {
    const runtime = join(root, "runtime");
    const config = join(root, "config");
    mkdirSync(runtime, { mode: 0o700 });
    mkdirSync(join(config, "squeal"), { recursive: true });
    writeFileSync(
      join(config, "squeal", "config.json"),
      JSON.stringify({ capacity: { hostSlots: 1, backgroundShare: 0.5 } }),
    );
    const env = { XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: config, HOME: root };
    const remote = createHostAdmission(machinePool("/remote/tree" as never, env));
    closing.push(remote);
    // One slot: the floor or the ceiling admits at most one worker, whatever this machine's load.
    expect(remote.admit({ want: 4, least: 1 }).grant).toBeLessThanOrEqual(1);
    expect(existsSync(join(runtime, "squeal", poolPermitFile(0)))).toBe(true);
    expect(existsSync(join(runtime, "squeal", poolPermitFile(1)))).toBe(false);
  });
});

describe("the daemon's wait for the remote machine (spec 021 D18, row 021-21)", () => {
  /** An `admit` that answers `answers` in turn, then grants 2; each ask is kept. */
  function answering(answers: AdmitAnswer[], asks: AdmitAsk[], during?: () => void) {
    return async (ask: AdmitAsk): Promise<AdmitAnswer> => {
      asks.push(ask);
      during?.();
      return answers.shift() ?? { grant: 2 };
    };
  }

  test("asks again until admitted and logs each ceiling refusal", async () => {
    const asks: AdmitAsk[] = [];
    const logs: string[] = [];
    const refusal =
      "the background ceiling refused a backlog tier: 20 busy CPUs, ceiling 18 (0.75 of 24 CPUs)";
    const grant = await remoteAdmission(
      answering([{ grant: 0, refusal }, { grant: 0 }], asks),
      { want: 4, least: 1 },
      { everyMs: 5, log: (line) => logs.push(line) },
    );
    expect(grant).toBe(2);
    expect(asks).toHaveLength(3);
    expect(logs).toEqual([`on its machine, ${refusal}`]);
  });

  test("ends at once on a cancel, and returns a grant that came meanwhile", async () => {
    const cancel = new AbortController();
    const asks: AdmitAsk[] = [];
    const waiting = remoteAdmission(
      answering([{ grant: 0 }], asks),
      { want: 4, least: 1 },
      { cancel: cancel.signal, everyMs: 60_000, log: () => {} },
    );
    await sleep(20);
    const at = Date.now();
    cancel.abort();
    expect(await waiting).toBeNull();
    expect(Date.now() - at).toBeLessThan(1_000);
    expect(asks).toEqual([{ want: 4, least: 1 }]);

    // The cancel comes while the host answers with a grant: a look for 0 workers returns it.
    const late = new AbortController();
    const lateAsks: AdmitAsk[] = [];
    const granted = await remoteAdmission(
      answering([{ grant: 3 }], lateAsks, () => late.abort()),
      { want: 4, least: 1 },
      { cancel: late.signal, everyMs: 5, log: () => {} },
    );
    expect(granted).toBeNull();
    expect(lateAsks).toEqual([
      { want: 4, least: 1 },
      { want: 0, least: 0 },
    ]);
  });
});
