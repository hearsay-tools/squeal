import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { acceptedAt, type ReadAsOne } from "../../src/core/scheduler/accept.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type {
  CheckKey,
  ResultRecord,
  Store,
  TestFileRef,
  WorktreeId,
} from "../../src/core/types/index.js";

/*
 * The read of the formats C3 reads as one (spec 011 C4 step 3, task 011-38),
 * once per file, key and keys read as one in a daemon (review 0.1.285 B1,
 * row 011-158): a closure change can move those keys while the key stays.
 * The copy fills an empty key only, and a copied fail of another worktree
 * stays held.
 */

const FILE: TestFileRef = { project: "", path: "test/a.test.ts" };
const HERE = "B" as WorktreeId;
const KEY = "key-now";
const now = () => 5_000;

/** A scratch store whose `copyNewest` calls are counted. */
function counted(): { store: Store; copies: () => number } {
  const dir = mkdtempSync(join(tmpdir(), "squeal-accept-"));
  const opened = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  onTestFinished(() => {
    opened.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let copies = 0;
  const results = {
    ...opened.results,
    copyNewest: (key: CheckKey, from: readonly CheckKey[]) => {
      copies += 1;
      return opened.results.copyNewest(key, from);
    },
  };
  return { store: { ...opened, results }, copies: () => copies };
}

/** `FILE`'s result at `key` from `worktree`, recorded at `at`. */
function stored(store: Store, key: CheckKey, at: number, outcome: "pass" | "fail", worktree = "A") {
  const record: ResultRecord = {
    check: { kind: "test", project: "", testPath: FILE.path, fullName: "adds" },
    key,
    outcome,
    durationMs: 1,
    location: null,
    fingerprint: outcome === "fail" ? "Error: no" : null,
    summary: outcome === "fail" ? "Error: no" : null,
    errors: [],
    provenance: {
      worktreeId: worktree,
      revision: 1,
      commit: "0".repeat(40),
      dirty: false,
      runId: randomUUID(),
      recordedAt: at,
    },
  };
  store.results.putMany([record]);
  return record;
}

/** Keys read as one that the test sets, as `KeyIndex.keysReadAsOne` gives them. */
function listing(): { listed: ReadAsOne; set: (keys: readonly CheckKey[]) => void } {
  let keys: readonly CheckKey[] = [];
  const listed: ReadAsOne = { keys: () => ({ testFile: FILE, keys }), read: new Map() };
  return { listed, set: (next) => (keys = next) };
}

describe("acceptedAt's read of the keys read as one", () => {
  it("reads a miss once per key and keys read as one, and again when only those keys move (review 0.1.285 B1)", () => {
    const { store, copies } = counted();
    const { listed, set } = listing();
    set(["before-1"]);
    expect(acceptedAt(store, HERE, KEY, now, listed)).toEqual({ hits: [], mayWait: true });
    acceptedAt(store, HERE, KEY, now, listed);
    expect(copies()).toBe(1);

    // The own closure dropped a path with no file: the key stays, the key before 011-158 moves.
    const pass = stored(store, "before-2", 1_000, "pass");
    set(["before-2"]);
    const { hits } = acceptedAt(store, HERE, KEY, now, listed);
    expect(copies()).toBe(2);
    expect(hits.map((hit) => [hit.key, hit.provenance])).toEqual([[KEY, pass.provenance]]);
    // Rows stand at the key now: no further read, whatever the keys read as one hold.
    set(["before-3"]);
    stored(store, "before-3", 2_000, "fail");
    expect(acceptedAt(store, HERE, KEY, now, listed).hits.map((hit) => hit.outcome)).toEqual([
      "pass",
    ]);
    expect(copies()).toBe(2);
  });

  it("copies the newest set into an empty key only, and keeps a copied fail of another worktree held", () => {
    const { store, copies } = counted();
    const { listed, set } = listing();
    stored(store, "before-1", 1_000, "pass");
    const fail = stored(store, "before-2", 2_000, "fail");
    set(["before-1", "before-2"]);
    expect(acceptedAt(store, HERE, KEY, now, listed)).toEqual({ hits: [], mayWait: false });
    expect(store.results.byKey(KEY, 0).map((r) => r.provenance)).toEqual([fail.provenance]);
    // Held: a lookup again reads nothing more and copies nothing over the held row.
    set(["before-1"]);
    expect(acceptedAt(store, HERE, KEY, now, listed)).toEqual({ hits: [], mayWait: false });
    expect(copies()).toBe(1);
    expect(store.results.byKey(KEY, 0).map((r) => r.provenance)).toEqual([fail.provenance]);
  });
});
