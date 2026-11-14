import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bumpStatesMarker,
  bumpStatesMarkerOf,
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
 * rows bumps its states marker in the same transaction (an upsert in its
 * repository, a removal in the ledger's commit, its one caller), and a
 * reader trusts the marker only while every registered daemon claimed its
 * own.
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
  it("counts each upsert of known states and test_file_keys rows, of that worktree only", () => {
    const store = seeded();
    claimStatesMarker(store, ID, INCARNATION);
    const writes: (() => void)[] = [
      () => store.knownStates.upsertMany([stateOf("pass")]),
      () => store.knownStates.upsertMany([stateOf("fail")]),
      () => store.testFileKeys.upsertMany([keyRow("running")]),
      () => bumpStatesMarkerOf(store, ID),
    ];
    for (const write of writes) {
      const before = seq(store) ?? 0;
      const mark = statesMark(store, ID);
      write();
      expect(seq(store)).toBe(before + 1);
      // The writer stays: the marker is still trusted, at another mark.
      expect(statesMark(store, ID)).not.toBe(mark);
      expect(statesMark(store, ID)).not.toBeNull();
    }
    expect(seq(store, OTHER)).toBeNull();
    store.knownStates.upsertMany([]);
    store.testFileKeys.upsertMany([]);
    expect(seq(store)).toBe(writes.length + 1);
  });

  it("leaves the removals to the ledger's commit, their one caller", () => {
    const SRC = join(import.meta.dirname, "../../src");
    const callers = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".ts"))
      .filter((path) => {
        const text = readFileSync(join(SRC, path), "utf8");
        return /knownStates\.removeMany\(|testFileKeys\.remove\(|\.retire\(worktreeId/.test(text);
      })
      .map((path) => relative(SRC, join(SRC, path)))
      .sort();
    // The sink's `retire` removes states; only the ledger retires, beside its key removals.
    expect(callers).toEqual(["core/scheduler/ledger.ts", "core/state/sink.ts"]);
    const ledger = readFileSync(join(SRC, "core/scheduler/ledger.ts"), "utf8");
    expect(ledger).toMatch(
      /if \(removed\.length > 0 \|\| retired\.length > 0\) bumpStatesMarkerOf/,
    );
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

  it("is not trusted while another worktree's daemon claimed none: it may heal this one's", () => {
    const store = seeded();
    claimStatesMarker(store, ID, INCARNATION);
    const other = { ...LIVE, token: "other", startedAt: 1_500 };
    store.worktrees.setDaemon(OTHER, other);
    expect(statesMark(store, ID)).toBeNull();
    claimStatesMarker(store, OTHER, daemonIncarnation(other));
    expect(statesMark(store, ID)).not.toBeNull();
    // A cross-worktree write of this release bumps this worktree's marker, not the writer's.
    const before = statesMark(store, ID);
    store.testFileKeys.upsertMany([keyRow("queued")]);
    expect(statesMark(store, ID)).not.toBe(before);
    store.worktrees.setDaemon(OTHER, null);
    expect(statesMark(store, ID)).not.toBeNull();
  });

  it("an unreadable marker reads as none, and a bump starts it again", () => {
    const store = seeded();
    store.meta.set(statesMarkerMetaKey(ID), "not json");
    expect(statesMark(store, ID)).toBeNull();
    store.knownStates.upsertMany([stateOf("pass")]);
    expect(seq(store)).toBe(1);
    store.meta.set(statesMarkerMetaKey(ID), "[1]");
    bumpStatesMarkerOf(store, ID);
    expect(seq(store)).toBe(1);
  });

  it("goes with its worktree", () => {
    const store = seeded();
    claimStatesMarker(store, ID, INCARNATION);
    store.worktrees.remove(ID);
    expect(store.meta.get(statesMarkerMetaKey(ID))).toBeNull();
  });
});
