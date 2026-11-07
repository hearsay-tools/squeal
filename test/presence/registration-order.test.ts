import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { daemonLiveness } from "../../src/core/presence/heartbeat.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { DaemonRecord } from "../../src/core/types/store-records.js";
import { createFixtureRepo, SLOW } from "../daemon/helpers.js";

/*
 * Review 0.1.404 B1 (row 011-294): a daemon's registration reads the clock
 * and the worktree's layout where it read them before the move. Before it,
 * `#register` (b9ef6a7e3, `daemon.ts` lines 453-475) ran, in one
 * transaction: the predecessor's runs released, the exit mark, the clock as
 * the handoff ends, `endHandoff` (the claim read and deleted, the short mark
 * deleted), the layout (`linkedWorktreeDir`), `worktrees.upsert`, the clock
 * for the heartbeat, `setDaemon`. The candidate of 0.1.404 read both clocks
 * and the layout first, so a pause inside the row's write left a heartbeat
 * older than the record. Here the store's `worktrees.upsert` takes 11 s of
 * the daemon's clock, past two 5 s heartbeat intervals.
 */

const trace = vi.hoisted(() => ({
  on: false,
  done: false,
  ops: [] as string[],
  clock: [] as number[],
  /** What the clock gained inside the row's write. */
  offset: 0,
  /** The record as stored at `setDaemon`, read in its transaction. */
  stored: null as DaemonRecord | null,
}));

/** A presence meta key by name, while the registration is traced. */
const META = [
  ["daemon-handoff-short:", "short"],
  ["daemon-handoff:", "claim"],
  ["daemon-exit:", "exit"],
] as const;

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/store/index.js")>();
  const named = (key: string) => META.find(([prefix]) => key.startsWith(prefix))?.[1];
  const note = (op: string | undefined) => {
    if (trace.on && op !== undefined) trace.ops.push(op);
  };
  return {
    ...actual,
    openStore: (...args: Parameters<typeof actual.openStore>) => {
      const store = actual.openStore(...args);
      if (actual.isStoreOpenFailure(store)) return store;
      const { meta, worktrees, testFileKeys } = store;
      const [get, set, del] = [meta.get.bind(meta), meta.set.bind(meta), meta.delete.bind(meta)];
      meta.get = (key) => {
        note(named(key));
        return get(key);
      };
      meta.set = (key, value) => {
        note(named(key));
        set(key, value);
      };
      meta.delete = (key) => {
        note(named(key));
        del(key);
      };
      const release = testFileKeys.releaseRunning.bind(testFileKeys);
      testFileKeys.releaseRunning = (id) => {
        // The first release is the registration's: trace it to its record.
        if (!trace.done) trace.on = true;
        note("release");
        release(id);
      };
      const upsert = worktrees.upsert.bind(worktrees);
      worktrees.upsert = (record) => {
        note("upsert");
        upsert(record);
        if (trace.on) trace.offset += 11_000;
      };
      const setDaemon = worktrees.setDaemon.bind(worktrees);
      const read = worktrees.get.bind(worktrees);
      worktrees.setDaemon = (id, daemon) => {
        note("setDaemon");
        setDaemon(id, daemon);
        if (!trace.on || daemon === null) return;
        trace.stored = read(id)?.daemon ?? null;
        trace.on = false;
        trace.done = true;
      };
      return store;
    },
  };
});

vi.mock("../../src/core/fs/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/fs/index.js")>();
  return {
    ...actual,
    linkedWorktreeDir: (...args: Parameters<typeof actual.linkedWorktreeDir>) => {
      if (trace.on) trace.ops.push("layout");
      return actual.linkedWorktreeDir(...args);
    },
  };
});

describe(
  "a daemon's registration reads its clock and layout in the old order (review 0.1.404 B1)",
  SLOW,
  () => {
    it("stores the heartbeat read after the row's write, however long that write took", async () => {
      const repo = createFixtureRepo();
      onTestFinished(repo.cleanup);
      const now = () => {
        const at = Date.now() + trace.offset;
        if (trace.on) {
          trace.ops.push("clock");
          trace.clock.push(at);
        }
        return at as EpochMs;
      };
      const daemon = await startDaemon({
        root: repo.root,
        env: repo.env,
        now,
        timings: { heartbeatMs: 5_000, checkMs: 60_000 },
      });
      if ("reason" in daemon) throw new Error(daemon.message);
      onTestFinished(() => daemon.stop("stop-requested").then(() => undefined));

      // The old order, from b9ef6a7e3's `#register`; soft, so the heartbeat's checks report too.
      expect
        .soft(trace.ops)
        .toEqual([
          "release",
          "exit",
          "clock",
          "claim",
          "claim",
          "short",
          "layout",
          "upsert",
          "clock",
          "setDaemon",
        ]);
      const [handoffAt = 0, heartbeatAt = 0] = trace.clock;
      expect(heartbeatAt - handoffAt).toBeGreaterThanOrEqual(11_000);
      expect(trace.stored?.heartbeatAt).toBe(heartbeatAt);
      // Fresh as registered, by the one heartbeat rule, at the clock's next reading.
      expect(daemonLiveness(trace.stored, now()).state).toBe("alive");
    });
  },
);
