import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HostCpu, TreeCpu } from "../../../src/core/capacity/cores.js";
import { clearMark, readMarks, writeMark } from "../../../src/core/capacity/marks.js";
import {
  createPermitPool,
  type PoolLease,
  poolPermitFile,
} from "../../../src/core/capacity/pool.js";
import {
  type AdmitAnswer,
  type AdmitAsk,
  admitRun,
  cancelledFirst,
  createHostAdmission,
  type HostAdmission,
  machinePool,
  remoteAdmission,
  UNGRANTED,
} from "../../../src/core/runner-host/remote/admission.js";
import type { RunOptions } from "../../../src/core/types/runner.js";
import { nodeTestTraits } from "../../../src/runners/node-test/traits.js";

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

/** The grant `remote` holds, which the test needs. */
function leaseOf(remote: HostAdmission): PoolLease {
  const claimed = remote.claim();
  if (claimed === null || claimed === UNGRANTED) throw new Error(`no grant held: ${claimed}`);
  return claimed;
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
    const lease = leaseOf(remote);
    expect(lease.grant).toBe(3);
    expect(remote.claim()).toBeNull();
    lease.release();
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

  test("the run's tail returns permits and states no more demand than the run asked", () => {
    const remote = admission(busy(2));
    expect(remote.admit({ want: 3, least: 1 }).grant).toBe(3);
    const lease = leaseOf(remote);
    const demand = () =>
      readMarks(dir, "reader", Date.now()).find((m) => m.id === "runner-host:/remote/tree")?.want;
    // Ten files left of a run three wide: its demand stays three.
    lease.shrinkTo(10);
    expect(demand()).toBe(3);
    lease.shrinkTo(1);
    expect(demand()).toBe(1);
    expect(free()).toBe(22);
    lease.release();
    expect(free()).toBe(23);
  });

  test("a pool that fails admits the run without a grant and says why", () => {
    const remote = createHostAdmission(() => {
      throw new Error("capacity pool directory is not this user's");
    });
    expect(remote.admit({ want: 3, least: 1 })).toEqual({
      grant: 3,
      failed: "capacity pool directory is not this user's",
    });
    // The run that follows goes without a grant, once; a later one without a look is refused.
    expect(remote.claim()).toBe(UNGRANTED);
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

describe("concurrent grants, one per attempt's token (row 026-23)", () => {
  test("holds each token's grant beside the others; a run claims only its own", () => {
    const remote = admission(busy(2));
    expect(remote.admit({ want: 2, least: 1, token: "r1:1" }).grant).toBe(2);
    expect(remote.admit({ want: 3, least: 1, token: "r2:2" }).grant).toBe(3);
    expect(free()).toBe(18);
    // A token with no grant held takes none of the others'.
    expect(remote.claim("r3:3")).toBeNull();
    const second = remote.claim("r2:2");
    const first = remote.claim("r1:1");
    expect(second).toMatchObject({ grant: 3 });
    expect(first).toMatchObject({ grant: 2 });
    expect(remote.claim("r1:1")).toBeNull();
    for (const lease of [first, second]) (lease as PoolLease).release();
    expect(free()).toBe(23);
  });

  test("a look returns only its own token's held grant; an untokened look for 0 returns all", () => {
    const remote = admission(busy(2));
    remote.admit({ want: 2, least: 1, token: "a" });
    remote.admit({ want: 3, least: 1, token: "b" });
    expect(remote.admit({ want: 0, least: 0, token: "a" })).toEqual({ grant: 0 });
    expect(free()).toBe(20);
    expect(remote.claim("a")).toBeNull();
    remote.admit({ want: 1, least: 1, token: "c" });
    expect(remote.admit({ want: 0, least: 0 })).toEqual({ grant: 0 });
    expect(free()).toBe(23);
    expect(remote.claim("b")).toBeNull();
  });

  test("each grant's hold ends alone, and close returns every grant", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const remote = admission(busy(2), 200);
      remote.admit({ want: 2, least: 1, token: "early" });
      vi.advanceTimersByTime(120);
      remote.admit({ want: 3, least: 1, token: "late" });
      expect(free()).toBe(18);
      vi.advanceTimersByTime(100);
      // The early grant's hold passed; the late one's has not.
      expect(free()).toBe(20);
      expect(remote.claim("early")).toBeNull();
      remote.admit({ want: 1, least: 1, token: "third" });
      remote.close();
      expect(free()).toBe(23);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a cancel after a grant came returns that slot's grant only; a sibling's stays held", async () => {
    const remote = admission(busy(2));
    expect(remote.admit({ want: 2, least: 1, token: "sibling" }).grant).toBe(2);
    const cancel = new AbortController();
    const asks: AdmitAsk[] = [];
    const granted = await remoteAdmission(
      async (ask) => {
        asks.push(ask);
        const answer = remote.admit(ask);
        cancel.abort();
        return answer;
      },
      { want: 3, least: 1, token: "cancelled" },
      { cancel: cancel.signal, everyMs: 5, log: () => {} },
    );
    expect(granted).toBeNull();
    expect(asks).toEqual([
      { want: 3, least: 1, token: "cancelled" },
      { want: 0, least: 0, token: "cancelled" },
    ]);
    expect(free()).toBe(21);
    expect(remote.claim("cancelled")).toBeNull();
    expect(remote.claim("sibling")).toMatchObject({ grant: 2 });
  });
});

describe("a wait that a cancel ends (row 026-23)", () => {
  test("answers true at a cancel before the promise settles, false once it settles", async () => {
    const cancel = new AbortController();
    const pending = cancelledFirst(new Promise(() => {}), cancel.signal);
    await sleep(10);
    cancel.abort();
    expect(await pending).toBe(true);
    expect(await cancelledFirst(sleep(5), new AbortController().signal)).toBe(false);
    expect(await cancelledFirst(sleep(5))).toBe(false);
    expect(await cancelledFirst(new Promise(() => {}), AbortSignal.abort())).toBe(true);
  });
});

describe("a wait the daemon's exit ends (row 026-30)", () => {
  test("ends before the first look when the exit already began", async () => {
    const asks: AdmitAsk[] = [];
    const granted = await remoteAdmission(
      async (ask) => {
        asks.push(ask);
        return { grant: 2 };
      },
      { want: 4, least: 1 },
      { exit: AbortSignal.abort(), everyMs: 5, log: () => {} },
    );
    expect(granted).toBeNull();
    expect(asks).toEqual([]);
  });

  test("ends at once between looks, with no look after it", async () => {
    const exit = new AbortController();
    const asks: AdmitAsk[] = [];
    const waiting = remoteAdmission(
      async (ask) => {
        asks.push(ask);
        return { grant: 0 };
      },
      { want: 4, least: 1 },
      { exit: exit.signal, everyMs: 60_000, log: () => {} },
    );
    await sleep(20);
    const at = Date.now();
    exit.abort();
    expect(await waiting).toBeNull();
    expect(Date.now() - at).toBeLessThan(1_000);
    expect(asks).toEqual([{ want: 4, least: 1 }]);
  });

  test("does not wait for a look the host never answers, and returns its grant if one comes", async () => {
    const exit = new AbortController();
    const asks: AdmitAsk[] = [];
    let answer: (a: AdmitAnswer) => void = () => {};
    const waiting = remoteAdmission(
      (ask) => {
        asks.push(ask);
        if (ask.want === 0) return new Promise(() => {});
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
      { want: 4, least: 1, token: "r1:1" },
      { exit: exit.signal, everyMs: 5, log: () => {} },
    );
    await sleep(10);
    exit.abort();
    expect(await waiting).toBeNull();
    // The grant comes late: it goes back, and that look, never answered either, holds nothing up.
    answer({ grant: 3 });
    await sleep(10);
    expect(asks).toEqual([
      { want: 4, least: 1, token: "r1:1" },
      { want: 0, least: 0, token: "r1:1" },
    ]);
  });

  test("returns a grant that came as the exit began, without waiting for that look", async () => {
    const exit = new AbortController();
    const asks: AdmitAsk[] = [];
    const granted = await remoteAdmission(
      async (ask) => {
        asks.push(ask);
        if (ask.want === 0) return new Promise<AdmitAnswer>(() => {});
        exit.abort();
        return { grant: 3 };
      },
      { want: 4, least: 1 },
      { exit: exit.signal, everyMs: 5, log: () => {} },
    );
    expect(granted).toBeNull();
    expect(asks).toEqual([
      { want: 4, least: 1 },
      { want: 0, least: 0 },
    ]);
  });
});

/*
 * Row 026-33 (#292): a 4-CPU remote machine, 3 slots, ceiling 3. A 4-file
 * node:test tier (`runner.tierSize` 4) asked its fewest workers, 4, above
 * the slots, and every remote tier asked as a background one: an edit's
 * tier waited behind the machine's background ceiling, or forever. Spec 021
 * D18: edit tiers, named waits and checkpoints stay outside that ceiling.
 */
describe("a remote tier on a 4-CPU machine (row 026-33, #292)", () => {
  /** The 4-CPU machine's admission over a pool in `dir`, its host at `machine`. */
  function smallMachine(machine: HostCpu): HostAdmission {
    const made = createHostAdmission((log) =>
      createPermitPool({
        dir,
        owner: { pid: process.pid, worktreeId: "runner-host:/remote/tree" },
        hostSlots: 3,
        cpus: 4,
        cores: tree,
        host: machine,
        log,
      }),
    );
    closing.push(made);
    return made;
  }

  const FILES = ["a", "b", "c", "d"].map((name) => ({
    project: "",
    path: `test/${name}.test.mjs`,
  }));
  const tierSized = nodeTestTraits({ tierSize: () => 4 });
  const runOf = (extra: Partial<RunOptions> = {}): RunOptions => ({
    runId: "r",
    logDir: join(root, "logs"),
    timeoutMs: null,
    ...extra,
  });

  /** `admitRun` against `remote`, each ask kept; `stop` aborts the run's wait after a refused look. */
  function admitting(remote: HostAdmission, asks: AdmitAsk[], stop?: AbortController) {
    return async (ask: AdmitAsk): Promise<AdmitAnswer> => {
      asks.push(ask);
      const answer = remote.admit(ask);
      if (answer.grant === 0) stop?.abort();
      return answer;
    };
  }

  test("an edit's tier is admitted at once above the ceiling while a background tier runs, at most 3 wide", async () => {
    backgroundRunsThere();
    const remote = smallMachine(busy(4));
    const asks: AdmitAsk[] = [];
    const logs: string[] = [];
    const grant = await admitRun(admitting(remote, asks), FILES, runOf(), {
      tierWidth: (file, at) => tierSized.tierWidth(file, at),
      everyMs: 5,
      log: (line) => logs.push(line),
    });
    // The background tier there holds one of the 3 slots: the edit's tier gets the other 2.
    expect(grant).toBe(2);
    expect(asks).toEqual([{ want: 4, least: 1, kind: "checkpoint" }]);
    expect(logs).toEqual([]);
  });

  test("a background tier still waits behind the ceiling, and asks as one", async () => {
    backgroundRunsThere();
    const remote = smallMachine(busy(4));
    const asks: AdmitAsk[] = [];
    const logs: string[] = [];
    const stop = new AbortController();
    const grant = await admitRun(
      admitting(remote, asks, stop),
      FILES,
      runOf({ background: true, signal: stop.signal }),
      {
        tierWidth: (file, at) => tierSized.tierWidth(file, at),
        everyMs: 5,
        log: (line) => logs.push(line),
      },
    );
    expect(grant).toBeNull();
    expect(asks).toEqual([{ want: 4, least: 1 }]);
    expect(logs).toEqual([
      "on its machine, the background ceiling refused a backlog tier: 4 busy CPUs, ceiling 3 (0.75 of 4 CPUs)",
    ]);
  });

  test("a tier of least 4 is refused by the ceiling with its line, then granted 3 once no background tier runs", () => {
    backgroundRunsThere();
    const remote = smallMachine(busy(4));
    expect(remote.admit({ want: 4, least: 4 })).toEqual({
      grant: 0,
      refusal:
        "the background ceiling refused a backlog tier: 4 busy CPUs, ceiling 3 (0.75 of 4 CPUs)",
    });
    clearMark(dir, "there");
    expect(remote.admit({ want: 4, least: 4 })).toEqual({ grant: 3 });
  });

  test("a checkpoint ask is admitted above the ceiling to the permits the other tier leaves; an ask without a kind is a background one", () => {
    backgroundRunsThere();
    const remote = smallMachine(busy(4));
    expect(remote.admit({ want: 4, least: 1 }).grant).toBe(0);
    expect(remote.admit({ want: 4, least: 1, kind: "checkpoint" })).toEqual({ grant: 2 });
    // A checkpoint of least 3 waits while the background tier holds one of the 3, never forever.
    expect(remote.admit({ want: 4, least: 4, kind: "checkpoint" })).toEqual({ grant: 0 });
    clearMark(dir, "there");
    expect(remote.admit({ want: 4, least: 4, kind: "checkpoint" })).toEqual({ grant: 3 });
  });
});
