import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODE_SCHEMA_VERSION } from "../../src/core/code/store/schema.js";
import type { CodeStore } from "../../src/core/code/store/types.js";
import { A, B, C, C2, read, record, share } from "../code/coverage/parts-fixtures.js";
import { fakeCounter, pass, worktree } from "../code/pass/helpers.js";
import {
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

describe("a store process per clone (row 021-36)", () => {
  it("writes two daemons' complexity and coverage, and neither daemon takes the write lock", async () => {
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

  // Review of 0.1.571 B2b: a batch given up on is settled before its caller is told anything.
  it("settles a late batch before it fails: the store process never writes it after", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const one = relay(at, "w1");
    const store = openThrough(at, one, 200);
    await warm(one, store);
    const t = transition("w1");

    // Another process holds the lock past the store process's 1 s busy timeout.
    const holder = await holdLock(at, 1_500);
    expect(() => store.transitions.append([t])).toThrow(/locked|busy/i);
    await holder.done;
    store.transitions.append([t]);

    // A barrier through the store process: anything it still held for w1 came before it.
    await until(() => {
      store.meta.set("barrier", "1");
      return one.counts.sent > 0;
    });
    expect(store.transitions.history("w1", t.check)).toHaveLength(1);
    expect(one.counts.late).toBe(1);
    expect(one.counts.failed).toBe(1);
    expect(running.stderr()).toMatch(/a batch of w1 failed/);
  }, 30_000);

  it("exits after its last client's grace, and not while a client lives", async () => {
    const at = fresh();
    const running = await storeProcess(at, { graceMs: 1_000, checkMs: 25 });
    const one = relay(at, "w1");
    const store = openThrough(at, one);
    await warm(one, store);
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

  // Review of 0.1.571 B4: a thread that ended at its start leaves the close nothing to wait for.
  it("closes at once when its thread already ended, and writes directly meanwhile", async () => {
    const at = fresh();
    const bad = join(at.commonDir, "bad-relay.mjs");
    writeFileSync(bad, "throw new Error('the relay did not start');\n");
    const one = relay(at, "w1", { thread: { script: bad } });
    const store = openThrough(at, one);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    store.meta.set("k", "v");
    expect(store.meta.get("k")).toBe("v");
    expect(one.counts.fallback.none).toBe(1);

    const started = performance.now();
    await one.close();
    expect(performance.now() - started).toBeLessThan(500);
  });
});
