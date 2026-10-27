import { expect, it } from "vitest";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { BusyWaits } from "../../src/core/store/index.js";
import { openHarness, openRepoStore, SLOW } from "./helpers.js";
import { A, B, DATA, fixture, scoped } from "./runtime-files-fixture.js";

it(
  "commits a raw-only observation when the result transaction retries after rollback",
  SLOW,
  async () => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    const meta = observedMetaKey("");
    const real = store.transaction.bind(store);
    let depth = 0;
    let rolledBack = false;
    let rawAfterRollback: string | null | undefined;
    store.transaction = ((fn: () => unknown) => {
      const record = depth === 0 && new Error().stack?.includes("TierRecords.#write");
      depth += 1;
      try {
        return real(() => {
          const result = fn();
          if (record && !rolledBack && store.meta.get(meta)?.includes(DATA)) {
            rolledBack = true;
            throw Object.assign(new Error("database is locked"), { errcode: 5 });
          }
          return result;
        });
      } catch (error) {
        if (record && rolledBack) rawAfterRollback = store.meta.get(meta);
        throw error;
      } finally {
        depth -= 1;
      }
    }) as typeof store.transaction;
    try {
      const h = await openHarness(repo.main, store, repo.commonDir, {
        observe: true,
        policy: scoped,
        busyWaits: new BusyWaits({ now: Date.now, note: () => {} }),
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(rolledBack).toBe(true);
      expect(rawAfterRollback).toBeNull();
      const raw = JSON.parse(store.meta.get(meta) ?? "{}");
      for (const path of [A, B]) {
        expect(raw[path]).toContain(DATA);
        expect(h.runsOf(path)).toHaveLength(1);
        expect(store.results.byKey(h.keyOf(path)).every((r) => r.outcome === "pass")).toBe(true);
      }
      expect(h.scheduler.extraFiles()).not.toContain(DATA);
      expect(h.errors).toEqual([]);
    } finally {
      store.transaction = real;
    }
  },
);
