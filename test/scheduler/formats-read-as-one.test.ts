import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import {
  coreEnvironmentInputs,
  environmentHash,
  KEY_FORMAT_VERSION,
  KEY_FORMATS_READ_AS_ONE,
} from "../../src/core/keys/index.js";
import { recordFailureKeys } from "../../src/core/slow/state.js";
import { checkIdentity } from "../../src/core/state/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type EpochMs,
  type ResultRecord,
  type Store,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, FakeRunner, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Spec 011 C3, C4 step 3 and C7 as amended 2026-10-20 (task 011-38, the
 * design's R1, `tasks/011-37/design.md` sections 4 and 6): a lookup that
 * misses at its key reads the key at each format C3 reads as one, copies the
 * newest set stored under one of them to its key, with its provenance and
 * record time, only while no row is stored there, and looks up again. Before
 * it, each release's raise ran every file once more after the upgrade.
 */

/** The two newest formats read as one; the release before this one stored under the first. */
const NEWEST = KEY_FORMAT_VERSION - 1;
const OLDER = KEY_FORMAT_VERSION - 2;
/** The format 004-81 raised from: not read as one (design section 4). */
const BELOW = 12;
const [F0, F1, F2, F3] = [0, 1, 2, 3].map(fileName) as [string, string, string, string];
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** `path`'s key at `format` in the worktree at `root`, as a daemon at that format computes it. */
async function keyAt(root: string, path: string, format: number): Promise<CheckKey> {
  const [environment] = await new FakeRunner([]).environment();
  if (environment === undefined) throw new Error("the fake runner has an environment");
  const core = coreEnvironmentInputs({
    squealVersion: "0.0.0-test",
    installedDependencies: "none",
    allowlist: DEFAULT_POLICY.env.allowlist,
  });
  const envHash = environmentHash(core, environment, () => null, format);
  const hash = await createFsHasher(root, "sha1").hash(path);
  return keyFromSegments(envHash, { project: "", path }, [encodeSegment(path, hash)]);
}

/** A stored result of `path`'s check `name` at `key`, by `worktreeId`, recorded at `at`. */
function stored(
  store: Store,
  worktreeId: string,
  path: string,
  key: CheckKey,
  at: EpochMs,
  options: { readonly name?: string; readonly fail?: boolean; readonly runId?: string } = {},
): ResultRecord {
  const record: ResultRecord = {
    check: { kind: "test", project: "", testPath: path, fullName: options.name ?? "passes" },
    key,
    outcome: options.fail === true ? "fail" : "pass",
    durationMs: 1,
    location: null,
    fingerprint: options.fail === true ? "no" : null,
    summary: options.fail === true ? "Error: no" : null,
    errors: [],
    provenance: {
      worktreeId,
      revision: 7,
      commit: "0".repeat(40),
      dirty: false,
      runId: options.runId ?? randomUUID(),
      recordedAt: at,
    },
  };
  store.results.putMany([record]);
  return record;
}

/** The rows stored at `key`, as their checks' names, outcomes and provenance. */
function rowsAt(store: Store, key: CheckKey) {
  return store.results.byKey(key, 0).map((r) => ({
    name: r.check.kind === "test" ? r.check.fullName : null,
    outcome: r.outcome,
    provenance: r.provenance,
  }));
}

const ranPaths = (s: Side) => s.runner.runs.flat().map((f) => f.path);

/** Wraps a store so each read at the formats read as one counts in `reads`, by key. */
function counting(reads: Map<CheckKey, number>): (store: Store) => Store {
  return (store) =>
    new Proxy(store, {
      get(target, prop, receiver) {
        if (prop !== "results") return Reflect.get(target, prop, receiver);
        const results = target.results;
        return {
          ...results,
          copyNewest: (key: CheckKey, from: readonly CheckKey[]) => {
            reads.set(key, (reads.get(key) ?? 0) + 1);
            return results.copyNewest(key, from);
          },
        };
      },
    });
}

describe("formats read as one (011-38)", SLOW, () => {
  it("lists the formats from 13 to the one below the current, each with the row that raised it (risk 6)", () => {
    const formats = Object.keys(KEY_FORMATS_READ_AS_ONE).map(Number);
    expect(formats).toEqual(Array.from({ length: KEY_FORMAT_VERSION - 13 }, (_, i) => 13 + i));
    for (const raisedBy of Object.values(KEY_FORMATS_READ_AS_ONE)) {
      expect(raisedBy).toMatch(/^\d{3}-\d+/);
    }
    expect(formats).toContain(NEWEST);
    expect(formats).toContain(OLDER);
    expect(formats).not.toContain(BELOW);
  });

  it("settles a file from its newest set at a listed format with no run, runs one stored at 12, and never replaces or mixes a set at the current key", async () => {
    const { main, other } = claimRepo(4);
    const a = worktreeIdFor(main);
    const own = worktreeIdFor(other);
    const keys = async (path: string) => ({
      current: await keyAt(other, path, KEY_FORMAT_VERSION),
      newest: await keyAt(other, path, NEWEST),
      older: await keyAt(other, path, OLDER),
      below: await keyAt(other, path, BELOW),
    });
    const [k0, k1, k2, k3] = await Promise.all([F0, F1, F2, F3].map(keys));
    if (!k0 || !k1 || !k2 || !k3) throw new Error("four files are keyed");
    expect(new Set(Object.values(k0)).size).toBe(4);

    const t = Date.now() - 60_000;
    const reads = new Map<CheckKey, number>();
    const b = side(other, { count: 4, wrap: counting(reads), policy: RUN_MISSING });
    // F0: this worktree's older daemons stored it at two listed formats, the newer set at NEWEST.
    stored(b.store, own, F0, k0.older, t - 2_000, { name: "older name" });
    const newest = stored(b.store, own, F0, k0.newest, t - 1_000);
    // F1: stored only at 12, below the list.
    stored(b.store, own, F1, k1.below, t - 1_000);
    // F2: a set at the current key, older than a set at NEWEST with another check.
    const kept = stored(b.store, a, F2, k2.current, t - 3_000);
    stored(b.store, a, F2, k2.newest, t - 500, { fail: true });
    stored(b.store, a, F2, k2.newest, t - 500, { name: "another" });
    // F3: another worktree's fail at OLDER that this worktree confirmed there (risk 8).
    const fail = stored(b.store, a, F3, k3.older, t - 1_000, { fail: true });
    recordFailureKeys(b.store, own, new Map([[checkIdentity(fail.check), k3.older]]));

    await b.scheduler.start();
    await b.scheduler.idle();
    for (const [path, k] of [
      [F0, k0],
      [F1, k1],
      [F2, k2],
      [F3, k3],
    ] as const) {
      expect(b.keyOf(path)).toBe(k.current);
    }

    // F0 settled from NEWEST's set: no run, its provenance and record time intact.
    expect(ranPaths(b)).not.toContain(F0);
    expect(rowsAt(b.store, k0.current)).toEqual([
      { name: "passes", outcome: "pass", provenance: newest.provenance },
    ]);
    expect(b.phase(F0)).toBeNull();
    // F1 ran: 12 is not read as one.
    expect(b.runner.ran(F1)).toBe(1);
    // F2's set at the current key stands as stored, neither replaced nor mixed.
    expect(ranPaths(b)).not.toContain(F2);
    expect(rowsAt(b.store, k2.current)).toEqual([
      { name: "passes", outcome: "pass", provenance: kept.provenance },
    ]);
    // F3: a confirmed fail is held once more under its new key, so the file runs once here.
    expect(b.runner.ran(F3)).toBe(1);
    expect(b.passing()).toBe(4);
    // Each key read once: F1's miss was probed again by its tier's selection without a read.
    expect(Object.fromEntries(reads)).toEqual({
      [k0.current]: 1,
      [k1.current]: 1,
      [k3.current]: 1,
    });
  });

  it("holds another worktree's unconfirmed fail at a listed format, and adopts a row an older daemon stores after the upgrade on the next pass (risk 7)", async () => {
    const { main, other } = claimRepo(2);
    const a = worktreeIdFor(main);
    const [failAt, laterAt] = await Promise.all([
      keyAt(other, F0, OLDER),
      keyAt(other, F1, NEWEST),
    ]);
    const b = side(other, { count: 2, policy: LOOKUP_ONLY });
    stored(b.store, a, F0, failAt, Date.now() - 1_000, { fail: true });
    b.runner.hold();
    await b.scheduler.start();
    // Held, so lookup-only still runs it once (row 011-159); until then no known failure.
    await expect.poll(() => b.phase(F0)).toBe("running");
    expect(b.store.knownStates.list(b.worktreeId).filter((s) => s.outcome === "fail")).toEqual([]);
    const why = readWhy(b.root, `${F0} > passes`);
    expect(why).toMatchObject({
      found: true,
      knownState: null,
      heldFailure: { outcome: "fail", provenance: { worktreeId: a } },
    });
    expect(formatWhy(why)).toContain("being confirmed");
    b.runner.release();
    await b.scheduler.idle();
    expect(ranPaths(b)).toEqual([F0]);
    expect(b.passing()).toBe(1);

    // The other worktree's daemon, a release behind, stores F1 at its own format.
    const later = stored(b.store, a, F1, laterAt, Date.now());
    await b.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await b.scheduler.idle();
    expect(ranPaths(b)).toEqual([F0]);
    expect(b.passing()).toBe(2);
    expect(rowsAt(b.store, (await keyAt(other, F1, KEY_FORMAT_VERSION)) as CheckKey)).toEqual([
      { name: "passes", outcome: "pass", provenance: later.provenance },
    ]);
  });
});
