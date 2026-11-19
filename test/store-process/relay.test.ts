import { afterEach, describe, expect, it } from "vitest";
import { CODE_SCHEMA_VERSION } from "../../src/core/code/store/schema.js";
import type { CodeStore } from "../../src/core/code/store/types.js";
import { markKey } from "../../src/core/store-process/guard.js";
import { A, B, C, C2, read, record, share } from "../code/coverage/parts-fixtures.js";
import { fakeCounter, pass, worktree } from "../code/pass/helpers.js";
import { type Clone, clone, openThrough, plain, relay, storeProcess, until } from "./helpers.js";

/*
 * Spec 021 D22 (row 021-36): a daemon's code-store writes go through its
 * relay to the clone's one store process, which is then the file's only
 * regular writer; with none, or one that refuses or does not answer, the
 * daemon writes directly, each batch once.
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

/** One daemon's code pass over a tree of two files, then a coverage record. */
async function daemonWork(at: Clone, worktreeId: string, store: CodeStore, key: string) {
  const tree = worktree(worktreeId, at.commonDir);
  tree.write("src/a.ts", `f 3 a-${worktreeId}\ng 25 b-${worktreeId}\n`);
  tree.write("src/b.ts", `h 7 c-${worktreeId}\n`);
  tree.revise();
  await pass(tree, store, fakeCounter());
  share(store, key, record([A, B, C]), 1_000);
  share(store, `${key}-2`, record([A, B, C2]), 2_000);
}

const EXPECTED = ["src/a.ts f pass 3", "src/a.ts g fail 25", "src/b.ts h pass 7"];

describe("a store process per clone (row 021-36)", () => {
  it("writes two daemons' complexity and coverage, and neither daemon takes the write lock", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const one = relay(at, "w1");
    const two = relay(at, "w2");
    const first = openThrough(at, one);
    const second = openThrough(at, two);

    await Promise.all([daemonWork(at, "w1", first, "k1"), daemonWork(at, "w2", second, "k2")]);

    expect(complexity(first, "w1")).toEqual(EXPECTED);
    expect(complexity(second, "w2")).toEqual(EXPECTED);
    expect(read(first, "k2")).toEqual(record([A, B, C]));
    expect(read(second, "k1-2")).toEqual(record([A, B, C2]));
    // Every batch went to the store process: the daemons never asked for the lock, so their busy
    // handler never ran (`direct` and `superseded` count each write the daemon made itself).
    for (const counts of [one.counts, two.counts]) {
      expect(counts.sent).toBeGreaterThan(3);
      expect(counts).toMatchObject({ direct: 0, superseded: 0, late: 0 });
    }
    expect(running.stderr()).not.toMatch(/failed/);
  });

  it("writes directly, as before, while no store process serves", async () => {
    const at = fresh();
    const one = relay(at, "w1");
    const store = openThrough(at, one);

    await daemonWork(at, "w1", store, "k1");

    expect(complexity(store, "w1")).toEqual(EXPECTED);
    expect(read(store, "k1")).toEqual(record([A, B, C]));
    expect(one.counts.sent).toBe(0);
    expect(one.counts.direct).toBeGreaterThan(3);
  });

  it("writes directly when the store process refuses the client's schema", async () => {
    const at = fresh();
    await storeProcess(at);
    const older = relay(at, "w1", { storeSchema: CODE_SCHEMA_VERSION - 1 });
    const store = openThrough(at, older);

    await daemonWork(at, "w1", store, "k1");

    expect(complexity(store, "w1")).toEqual(EXPECTED);
    expect(older.counts.sent).toBe(0);
    expect(older.counts.direct).toBeGreaterThan(3);
  });

  it("waits no longer than the busy timeout, then settles the batch by its mark, written once", async () => {
    const at = fresh();
    await storeProcess(at);
    const one = relay(at, "w1");
    const store = openThrough(at, one, 200);
    store.meta.set("n", "0");
    expect(one.counts.sent).toBe(1);
    const bump = () =>
      store.transaction(() => {
        store.meta.set("bumped", "1");
        store.meta.setWhilePresent("n", "1", "n");
      });

    // Another process holds the lock: the store process waits for it, the daemon does not.
    const holder = plain(at);
    holder.exec("BEGIN IMMEDIATE");
    const started = performance.now();
    expect(bump).toThrow(/locked|busy/i);
    const waited = performance.now() - started;
    holder.exec("COMMIT");

    expect(waited).toBeLessThan(200 + 150);
    expect(one.counts.late).toBe(1);
    // The store process writes the batch once the lock is free; the daemon wrote nothing itself.
    await until(
      () => holder.prepare("SELECT 1 FROM meta WHERE key = 'bumped'").get() !== undefined,
    );
    const mark = holder.prepare("SELECT value FROM meta WHERE key = ?").get(markKey("w1"));
    expect(mark).toBeDefined();
    expect(one.counts.direct).toBe(0);

    // The relay is free again: the next batch goes to the store process.
    await until(() => {
      store.meta.set("after", "1");
      return one.counts.sent >= 2 || one.counts.direct > 0;
    });
    expect(store.meta.get("after")).toBe("1");
  });

  it("exits after its last client's grace, and not while a client lives", async () => {
    const at = fresh();
    const running = await storeProcess(at, { graceMs: 1_000, checkMs: 25 });
    const one = relay(at, "w1");
    const store = openThrough(at, one);
    store.meta.set("k", "v");
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
});
