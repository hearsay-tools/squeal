import { rmSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { CODE_SCHEMA_VERSION } from "../../src/core/code/store/schema.js";
import type { CodeStore } from "../../src/core/code/store/types.js";
import { isBusy } from "../../src/core/store/connection.js";
import { A, B, C, C2, read, record, share } from "../code/coverage/parts-fixtures.js";
import { fakeCounter, pass, worktree } from "../code/pass/helpers.js";
import {
  alive,
  type Clone,
  clone,
  holdLock,
  openThrough,
  relay,
  storeProcess,
  until,
  warm,
} from "./helpers.js";

/*
 * Spec 021 D22.3 and D22.4 (row 021-36, rebuilt on one owner per batch): a
 * daemon's code-store writes go through its relay to the clone's one store
 * process, which is then the file's only regular writer. The daemon's main
 * thread never waits for a write; the relay's thread writes a batch itself
 * only when no store process can write it any more.
 */

const clones: Clone[] = [];
afterEach(async () => {
  for (const at of clones.splice(0)) await at.cleanup();
});
const fresh = () => {
  const at = clone();
  clones.push(at);
  return at;
};

const complexity = (store: CodeStore, worktreeId: string) =>
  store.states
    .list(worktreeId, { measure: "complexity" })
    .map((s) => `${s.check.path} ${s.check.qualifiedName} ${s.outcome} ${s.value}`)
    .sort();

/** One daemon's code pass over a tree of two files, then a coverage record; written once it returns. */
async function daemonWork(at: Clone, worktreeId: string, store: CodeStore, key: string) {
  const tree = worktree(worktreeId, at.commonDir);
  tree.write("src/a.ts", `f 3 a-${worktreeId}\ng 25 b-${worktreeId}\n`);
  tree.write("src/b.ts", `h 7 c-${worktreeId}\n`);
  tree.revise();
  await pass(tree, store, fakeCounter());
  await share(store, key, record([A, B, C]), 1_000);
  await share(store, `${key}-2`, record([A, B, C2]), 2_000);
  await store.sent();
}

/** A transition of `f`'s complexity in worktree `worktreeId`: a row each `append` adds. */
const transition = (worktreeId: string) => ({
  worktreeId,
  check: { kind: "code" as const, path: "src/a.ts", qualifiedName: "f", occurrence: 0 },
  measure: "complexity" as const,
  kind: "first-seen-fail" as const,
  from: null,
  to: "fail" as const,
  fromValue: null,
  toValue: 25,
  threshold: 20,
  revision: 1,
  at: 1_000,
});

const EXPECTED = ["src/a.ts f pass 3", "src/a.ts g fail 25", "src/b.ts h pass 7"];

/** Timing is asserted on a machine loaded no more than the other timing tests allow (chain-load). */
const quiet = () => (loadavg()[0] ?? 0) <= 8;

// Each test starts processes and threads from the sources: slow on a loaded host.
describe("a store process per clone (row 021-36)", { timeout: 60_000 }, () => {
  it("writes two daemons' complexity and coverage, and neither daemon writes the store itself", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const one = relay(at, "w1");
    const two = relay(at, "w2");
    const first = openThrough(at, one);
    const second = openThrough(at, two);
    await Promise.all([warm(one, first), warm(two, second)]);

    await Promise.all([daemonWork(at, "w1", first, "k1"), daemonWork(at, "w2", second, "k2")]);

    expect(complexity(first, "w1")).toEqual(EXPECTED);
    expect(complexity(second, "w2")).toEqual(EXPECTED);
    expect(read(first, "k2")).toEqual(record([A, B, C]));
    expect(read(second, "k1-2")).toEqual(record([A, B, C2]));
    // Every batch went to the store process: the daemons never asked SQLite for its write lock.
    for (const counts of [one.counts, two.counts]) {
      expect(counts.sent).toBeGreaterThan(3);
      expect(counts).toMatchObject({ direct: 0, superseded: 0, failed: 0 });
    }
    expect(running.stderr()).not.toMatch(/failed/);
  });

  it("writes in its thread, as before, while no store process serves", async () => {
    const at = fresh();
    const one = relay(at, "w1");
    const store = openThrough(at, one);

    await daemonWork(at, "w1", store, "k1");

    expect(complexity(store, "w1")).toEqual(EXPECTED);
    expect(read(store, "k1")).toEqual(record([A, B, C]));
    expect(one.counts.sent).toBe(0);
    expect(one.counts.fallback.none).toBeGreaterThan(3);
  });

  it("writes in its thread what the store process refuses for the client's schema", async () => {
    const at = fresh();
    await storeProcess(at);
    const older = relay(at, "w1", { storeSchema: CODE_SCHEMA_VERSION - 1 });
    const store = openThrough(at, older);

    await daemonWork(at, "w1", store, "k1");

    expect(complexity(store, "w1")).toEqual(EXPECTED);
    expect(older.counts.sent).toBe(0);
    expect(older.counts.fallback.refused).toBeGreaterThan(3);
  });

  // Review of 0.1.571, R1 B2 (bound): the daemon's main thread waited 1,025 ms against a 200 ms bound.
  it("never blocks the daemon's main thread while another process holds the lock", async () => {
    const at = fresh();
    await storeProcess(at);
    const one = relay(at, "w1");
    const store = openThrough(at, one, 200);
    await warm(one, store);
    const t = transition("w1");

    // Past the store process's own 1 s busy timeout: it fails the batch busy and is sent it again.
    const holder = await holdLock(at, 1_500);
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const began = performance.now();
    store.transitions.append([t]);
    const call = performance.now() - began;
    await store.sent();
    delay.disable();
    await holder.done;

    const load = loadavg()[0] ?? 0;
    console.log(
      `main thread beside a 1.5 s lock: append ${call.toFixed(1)} ms, event-loop delay max ` +
        `${(delay.max / 1e6).toFixed(1)} ms; load average ${load.toFixed(1)}`,
    );
    expect(call).toBeLessThan(50);
    if (quiet()) expect(delay.max / 1e6).toBeLessThan(50);
    expect(store.transitions.history("w1", t.check)).toHaveLength(1);
    expect(one.counts).toMatchObject({ sent: 1, direct: 0, failed: 0 });
  }, 30_000);

  // Review of 0.1.571, R1 B2: after the 30 s cap a failed attempt and its retry both committed.
  it("ends a stopped store process, then fails busy only what nobody can write: a retry leaves one row", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const one = relay(at, "w1");
    const store = openThrough(at, one, 200);
    await warm(one, store);
    const t = transition("w1");

    process.kill(running.pid, "SIGSTOP");
    at.later(() => {
      if (alive(running.pid)) process.kill(running.pid, "SIGCONT");
    });
    const holder = await holdLock(at, 31_000);
    store.transitions.append([t]);
    // The stopped process answers no ping: ended within a second; the lock stays busy past D1's bound.
    await expect(store.sent()).rejects.toSatisfy(isBusy);
    expect(await running.ended).toBe("exit SIGKILL");
    // The caller retries, as a busy-write caller does, until the lock is free.
    for (;;) {
      store.transitions.append([t]);
      try {
        await store.sent();
        break;
      } catch (error) {
        if (!isBusy(error)) throw error;
      }
    }
    await holder.done;

    expect(store.transitions.history("w1", t.check)).toHaveLength(1);
    expect(one.counts.fallback.none + one.counts.fallback.hung).toBe(1);
    expect(one.counts.sent).toBe(0);
  }, 90_000);

  // Review of 0.1.571, R1 B5: a mark-confirmed remote commit was missing from the D22.6 counts.
  it("counts a committed batch whose answer was lost once, as the store process's, and writes it no more", async () => {
    const at = fresh();
    // The store process stops itself once a batch committed, before its client can hear so.
    const running = await storeProcess(at, { pauseAt: "store-written" });
    at.later(() => {
      if (alive(running.pid)) process.kill(running.pid, "SIGCONT");
    });
    const one = relay(at, "w1");
    const store = openThrough(at, one);
    const t = transition("w1");

    store.transitions.append([t]);
    await store.sent();

    expect(await running.ended).toBe("exit SIGKILL");
    expect(store.transitions.history("w1", t.check)).toHaveLength(1);
    expect(one.counts).toMatchObject({ sent: 1, superseded: 1, direct: 0, failed: 0 });
  }, 30_000);

  it("exits after its last client's grace, and not while a client lives", async () => {
    const at = fresh();
    const running = await storeProcess(at, { graceMs: 1_000, checkMs: 25 });
    const one = relay(at, "w1");
    const store = openThrough(at, one);
    await warm(one, store);
    store.meta.set("k", "v");
    await store.sent();
    expect(one.counts.sent).toBe(1);

    let ended: string | null = null;
    void running.ended.then((end) => {
      ended = end;
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(ended).toBeNull();

    await one.close();
    const closedAt = performance.now();
    await until(() => ended !== null, 5_000);
    expect(ended).toBe("idle");
    expect(performance.now() - closedAt).toBeGreaterThanOrEqual(900);
  });

  // Review of 0.1.571 B4: a thread that ended at its start leaves the close nothing to wait for.
  it("closes at once when its thread already ended, and fails its writes without waiting", async () => {
    const at = fresh();
    const bad = join(at.commonDir, "bad-relay.mjs");
    writeFileSync(bad, "throw new Error('the relay did not start');\n");
    const one = relay(at, "w1", { thread: { script: bad } });
    const store = openThrough(at, one);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    store.meta.set("k", "v");
    await expect(store.sent()).rejects.toThrow(/relay/);
    expect(one.counts.failed).toBe(1);

    const started = performance.now();
    await one.close();
    expect(performance.now() - started).toBeLessThan(500);
  });

  // D22.2 (candidate CI of 0.1.571): store processes outlived the daemons tests stopped.
  it("stops when the last client's daemon was stopped on purpose, and keeps its grace otherwise", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    let ended: string | null = null;
    void running.ended.then((end) => {
      ended = end;
    });
    const clients = ["w1", "w2", "w3"].map((id) => {
      const through = relay(at, id);
      return { through, store: openThrough(at, through) };
    });
    for (const { through, store } of clients) await warm(through, store);

    // Other clients still hold their leases: no stop.
    await clients[0]?.through.close(true);
    await clients[1]?.through.close(true);
    // The last client's daemon ends on its own: the grace holds.
    await clients[2]?.through.close(false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(ended).toBeNull();

    // A daemon that comes and is stopped on purpose, the only client: the store process goes.
    const last = relay(at, "w4");
    await warm(last, openThrough(at, last));
    await last.close(true);
    expect(await running.ended).toBe("stopped");
  }, 60_000);

  it("stops when its repository was removed under it", async () => {
    const at = fresh();
    const running = await storeProcess(at, { checkMs: 50 });
    rmSync(join(at.commonDir, "squeal"), { recursive: true, force: true });
    expect(await running.ended).toBe("removed");
  }, 60_000);
});
