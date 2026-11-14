import { describe, expect, it } from "vitest";
import {
  bumpStatesMarker,
  claimStatesMarker,
  statesMark,
  statesMarkerMetaKey,
} from "../../src/core/store/states-marker.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import { daemonIncarnation } from "../../src/core/types/daemon.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import type { DaemonRecord } from "../../src/core/types/store-records.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Row 011-45: every write to a worktree's known states or `test_file_keys`
 * rows bumps its states marker in the same transaction, and a reader trusts
 * the marker only while the daemon that claimed it is the registered one.
 */

const ID = "wt-marker";
const OTHER = "wt-other";
const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-marker.sock",
  startedAt: 1_000,
  heartbeatAt: 2_000,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
  token: "live",
};
const INCARNATION = daemonIncarnation(LIVE);
const CHECK = { kind: "test", project: "", testPath: "a.test.ts", fullName: "adds" } as const;
const FILE = { project: "", path: "a.test.ts" as never };

function seeded(): Store {
  const store = open(fakeCommonDir());
  for (const id of [ID, OTHER]) {
    store.worktrees.upsert({
      id,
      root: `/tmp/${id}`,
      commonDir: "/tmp/.git",
      isMain: id === ID,
      registeredAt: 1,
      daemon: id === ID ? LIVE : null,
    });
  }
  return store;
}

const seq = (store: Store, id = ID): number | null => {
  const raw = store.meta.get(statesMarkerMetaKey(id));
  return raw === null ? null : (JSON.parse(raw) as { seq: number }).seq;
};

const stateOf = (outcome: "pass" | "fail") => ({
  worktreeId: ID,
  check: CHECK,
  outcome,
  validity: "current" as const,
  pendingPhase: null,
  observedAt: 1,
  commit: null,
  origin: { kind: "own" as const },
  durationMs: 5,
  location: null,
  summary: null,
  fingerprint: null,
});

const keyRow = (pending: "queued" | "running" | null) => ({
  worktreeId: ID,
  testFile: FILE,
  key: "k" as CheckKey,
  revision: 1 as RevisionNumber,
  pending,
});

describe("the states marker (row 011-45)", () => {
  it("counts each write to known states and test_file_keys rows, of that worktree only", () => {
    const store = seeded();
    claimStatesMarker(store, ID, INCARNATION);
    const writes: (() => void)[] = [
      () => store.knownStates.upsertMany([stateOf("pass")]),
      () => store.knownStates.upsertMany([stateOf("fail")]),
      () => store.knownStates.removeMany(ID, [CHECK]),
      () => store.testFileKeys.upsertMany([keyRow("running")]),
      () => store.testFileKeys.releaseRunning(ID),
      () => store.testFileKeys.remove(ID, [FILE]),
    ];
    for (const write of writes) {
      const before = seq(store) ?? 0;
      write();
      expect(seq(store)).toBe(before + 1);
    }
    expect(seq(store, OTHER)).toBeNull();
  });

  it("is not bumped by a write that changes nothing", () => {
    const store = seeded();
    claimStatesMarker(store, ID, INCARNATION);
    const before = seq(store);
    store.knownStates.upsertMany([]);
    store.testFileKeys.upsertMany([]);
    store.testFileKeys.releaseRunning(ID);
    store.knownStates.removeMany(ID, []);
    expect(seq(store)).toBe(before);
  });

  it("moves with the rows it counts: a rolled-back write leaves both", () => {
    const store = seeded();
    claimStatesMarker(store, ID, INCARNATION);
    const before = statesMark(store, ID);
    expect(() =>
      store.transaction(() => {
        store.knownStates.upsertMany([stateOf("fail")]);
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(statesMark(store, ID)).toBe(before);
    expect(store.knownStates.list(ID)).toEqual([]);
  });

  it("is trusted only while the daemon that claimed it is the registered one", () => {
    const store = seeded();
    // No marker: a daemon before row 011-45 writes none.
    expect(statesMark(store, ID)).toBeNull();
    // A bump with no claim names no writer.
    bumpStatesMarker(connectionOf(store), [ID]);
    expect(statesMark(store, ID)).toBeNull();

    claimStatesMarker(store, ID, INCARNATION);
    const claimed = statesMark(store, ID);
    expect(claimed).not.toBeNull();
    store.knownStates.upsertMany([stateOf("pass")]);
    const written = statesMark(store, ID);
    expect(written).not.toBeNull();
    expect(written).not.toBe(claimed);

    // An older daemon registers: it claims nothing, and may write with no bump.
    store.worktrees.setDaemon(ID, { ...LIVE, startedAt: 3_000, squealVersion: "0.1.112" });
    expect(statesMark(store, ID)).toBeNull();
    // No daemon at all.
    store.worktrees.setDaemon(ID, null);
    expect(statesMark(store, ID)).toBeNull();
    // A daemon with no incarnation claims a marker no reader trusts.
    claimStatesMarker(store, ID, null);
    expect(statesMark(store, ID)).toBeNull();
  });

  it("an unreadable marker reads as none, and a bump starts it again", () => {
    const store = seeded();
    store.meta.set(statesMarkerMetaKey(ID), "not json");
    expect(statesMark(store, ID)).toBeNull();
    store.knownStates.upsertMany([stateOf("pass")]);
    expect(seq(store)).toBe(1);
  });

  it("goes with its worktree", () => {
    const store = seeded();
    claimStatesMarker(store, ID, INCARNATION);
    store.worktrees.remove(ID);
    expect(store.meta.get(statesMarkerMetaKey(ID))).toBeNull();
  });
});
