import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../../src/core/status/snapshot.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { StatusSnapshot, Store } from "../../src/core/types/index.js";
import { e2eSuite, MATH, PLUGINS } from "./harness.js";

/*
 * Task 002-20, the cause of the Codex transitions flake: `buildSnapshot`
 * reads the latest revision, the known states and the header in separate
 * statements, outside one read transaction. A revision the daemon commits
 * between them pairs the new revision with the previous one's states:
 * nothing pending, the old failure `current`, no run at that revision, which
 * `E2E.settle` accepts. Under load the status process is off CPU between its
 * reads; here `knownStates.list` busy-waits `DELAY_MS` after reading instead.
 * Opt in with SQUEAL_PROBE_TORN_STATUS=1: it fails until the snapshot is read
 * in one transaction.
 */

const DELAY_MS = 30;
const EDITS = 6;
const fixture = e2eSuite();

/** `store` with a pause after each known-states read, as a descheduled reader has. */
function pausedAfterStates(store: Store): Store {
  const states = store.knownStates;
  const paused = new Proxy(states, {
    get: (target, prop, receiver) =>
      prop !== "list"
        ? Reflect.get(target, prop, receiver)
        : (...args: Parameters<typeof states.list>) => {
            const listed = states.list(...args);
            const until = performance.now() + DELAY_MS;
            while (performance.now() < until) {
              // Off CPU between two reads of one snapshot.
            }
            return listed;
          },
  });
  return new Proxy(store, {
    get: (target, prop, receiver) =>
      prop === "knownStates" ? paused : Reflect.get(target, prop, receiver),
  });
}

describe.skipIf(process.env.SQUEAL_PROBE_TORN_STATUS === undefined).each(PLUGINS)(
  "status read while revisions land, $name",
  (plugin) => {
    it("never reads as settled at a revision with no run", async (ctx) => {
      const e = fixture(ctx, plugin);
      await e.hook("session-start", e.main);
      await e.daemonReady(e.main);
      await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0);
      const opened = openStore(join(e.main, ".git"), { create: false, busyTimeoutMs: 1_000 });
      if (isStoreOpenFailure(opened)) throw new Error(`store: ${opened.reason}`);
      const store = pausedAfterStates(opened);

      const torn: object[] = [];
      let snapshots = 0;
      let stop = false;
      const poll = async () => {
        while (!stop) {
          await tick();
          let s: StatusSnapshot;
          try {
            s = buildSnapshot(store, e.main, Date.now());
          } catch {
            continue; // Busy: the daemon holds the write lock.
          }
          snapshots++;
          const quiet =
            s.daemon.state === "alive" &&
            s.counts.pending +
              s.testFilesWithoutChecks.pending +
              s.testFilesWithoutChecks.unknown ===
              0;
          // Every edit re-keys test/math.test.ts, so a settled revision has a run.
          if (!quiet || e.runs(e.main).some((r) => r.revision === s.revision)) continue;
          torn.push({
            revision: s.revision,
            firstRead: s.dirtyObservedAt,
            counts: s.counts,
            runnerPartPending: s.runnerPartPending,
            knownFailures: s.knownFailures.map((f) => [f.validity, f.observedAt]),
            consistent: buildSnapshot(opened, e.main, Date.now()).counts,
          });
        }
      };
      const polling = poll();
      try {
        for (let i = 0; i < EDITS; i++) await e.edit(e.main, "math", MATH(i % 2 ? "+" : "-"));
      } finally {
        stop = true;
        await polling;
        opened.close();
      }
      expect(snapshots).toBeGreaterThan(0);
      expect(torn).toEqual([]);
    }, 240_000);
  },
);
