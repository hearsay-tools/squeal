import { describe, expect, it } from "vitest";
import { assembleClosure } from "../../src/core/keys/closure.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { ImportRewalk, rewalkMetaKey } from "../../src/core/scheduler/import-rewalk.js";
import type { Ledger } from "../../src/core/scheduler/ledger.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerClosure } from "../../src/core/types/runner.js";
import { fakeCommonDir, open, tempDir, worktree } from "../store/helpers.js";

/*
 * R1 0.1.416 (proof round 2): the re-walk goes until nothing is left. A
 * file given up at a key (its fresh closure is not the one the key covers,
 * as for a key taken from another worktree's closure, or it had nothing to
 * store) is tried again once its key moves, during the pass and after it,
 * and the marker is written only when every listed file at its current
 * key has a walk or was given up there, and no closure call failed. A real
 * store; the keys and ledger are the few calls the pass makes.
 */

const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };
const VERSION = "0.0.0-test";

const closure = (ref: TestFileRef, source: string): RunnerClosure => ({
  testFile: ref,
  paths: [ref.path, source],
  imports: [{ path: ref.path, sha1: "s", static: [source], dynamic: [] }],
});

/** One worktree: each file's key and the closure that key covers, which a test moves. */
function setup() {
  const store = open(fakeCommonDir());
  store.worktrees.upsert(worktree("w1", tempDir("squeal-rewalk-retry-")));
  const keyed = new Map<string, { key: string; closure: RunnerClosure }>();
  const set = (ref: TestFileRef, key: string, from: RunnerClosure) =>
    keyed.set(testFileId(ref), { key, closure: from });
  const context = {
    worktreeId: "w1",
    store,
    now: () => 1_000,
    keys: {
      index: {
        key: (ref: TestFileRef) => keyed.get(testFileId(ref))?.key ?? null,
        closure: (ref: TestFileRef) => {
          const held = keyed.get(testFileId(ref));
          return held === undefined ? undefined : assembleClosure(held.closure, []);
        },
        environment: () => "env-1",
      },
      observes: () => false,
      observedOf: () => [],
      effectiveObserved: () => [],
      declaredFor: () => [],
      environmentFiles: () => [],
    },
  } as unknown as SchedulerContext;
  const files = new Map([A, B].map((ref) => [testFileId(ref), { ref }]));
  const ledger = {
    files,
    file: (ref: TestFileRef) => files.get(testFileId(ref)),
  } as unknown as Ledger;
  const rows = () =>
    connectionOf(store)
      .all("SELECT path, key FROM test_file_imports ORDER BY path")
      .map((row) => `${row.path}@${row.key}`);
  const marker = () => store.meta.get(rewalkMetaKey("w1"));
  return { context, ledger, set, rows, marker };
}

describe("the re-walk's convergence (R1 0.1.416)", () => {
  const ca = closure(A, "src/a.ts");
  const fresh = closure(B, "src/new.ts");
  const stale = closure(B, "src/old.ts");

  it("walks a refused file again once its key moved, and marks the version only after", () => {
    const { context, ledger, set, rows, marker } = setup();
    set(A, "ka", ca);
    // B is keyed by another worktree's closure: its fresh walk is refused at kb1.
    set(B, "kb1", stale);
    const rewalk = new ImportRewalk(VERSION);
    const first = rewalk.next(context, ledger);
    expect(first).toEqual([A, B]);
    rewalk.apply(context, ledger, first ?? [], [ca, fresh], new Set());
    expect(rows()).toEqual(["test/a.test.ts@ka"]);
    expect(marker()).toBeNull();

    // Start-up re-keys B to the closure its walk gives.
    set(B, "kb2", fresh);
    const second = rewalk.next(context, ledger);
    expect(second).toEqual([B]);
    rewalk.apply(context, ledger, second ?? [], [fresh], new Set());
    expect(rewalk.next(context, ledger)).toBeNull();
    expect(rows()).toEqual(["test/a.test.ts@ka", "test/b.test.ts@kb2"]);
    expect(marker()).toBe(VERSION);
  });

  it("marks the version with a refusal at a key that did not move", () => {
    const { context, ledger, set, rows, marker } = setup();
    set(A, "ka", ca);
    set(B, "kb1", stale);
    const rewalk = new ImportRewalk(VERSION);
    rewalk.apply(context, ledger, rewalk.next(context, ledger) ?? [], [ca, fresh], new Set());
    expect(rewalk.next(context, ledger)).toBeNull();
    expect(rows()).toEqual(["test/a.test.ts@ka"]);
    expect(marker()).toBe(VERSION);
  });

  it("after the pass, walks a refused file again once a later revision moved its key, and only it", () => {
    const { context, ledger, set, rows, marker } = setup();
    set(A, "ka", ca);
    set(B, "kb1", stale);
    const rewalk = new ImportRewalk(VERSION);
    rewalk.apply(context, ledger, rewalk.next(context, ledger) ?? [], [ca, fresh], new Set());
    expect(rewalk.next(context, ledger)).toBeNull();
    expect(marker()).toBe(VERSION);
    expect(rewalk.next(context, ledger)).toBeNull();

    // A revision moves both keys; only B was given up, so only B is walked again.
    set(A, "ka2", ca);
    set(B, "kb2", fresh);
    const again = rewalk.next(context, ledger);
    expect(again).toEqual([B]);
    rewalk.apply(context, ledger, again ?? [], [fresh], new Set());
    expect(rows()).toEqual(["test/a.test.ts@ka", "test/b.test.ts@kb2"]);
    expect(rewalk.next(context, ledger)).toBeNull();
  });

  it("writes no marker while a closure call failed, so the next start tries it again", () => {
    const { context, ledger, set, rows, marker } = setup();
    set(A, "ka", ca);
    set(B, "kb", fresh);
    const rewalk = new ImportRewalk(VERSION);
    // The runner answered A only.
    rewalk.apply(context, ledger, rewalk.next(context, ledger) ?? [], [ca], new Set());
    expect(rewalk.next(context, ledger)).toBeNull();
    expect(rows()).toEqual(["test/a.test.ts@ka"]);
    expect(marker()).toBeNull();
  });

  it("looks again at a file a revision changed while its chunk was read, at the key it moved to", () => {
    const { context, ledger, set, rows } = setup();
    set(A, "ka", ca);
    set(B, "kb", fresh);
    const rewalk = new ImportRewalk(VERSION);
    const first = rewalk.next(context, ledger) ?? [];
    rewalk.apply(context, ledger, first, [ca, fresh], new Set(["src/new.ts"]));
    expect(rows()).toEqual(["test/a.test.ts@ka"]);
    // The revision re-keyed B; the pass walks it at its new key.
    set(B, "kb2", fresh);
    const again = rewalk.next(context, ledger) ?? [];
    expect(again).toEqual([B]);
    rewalk.apply(context, ledger, again, [fresh], new Set());
    expect(rows()).toEqual(["test/a.test.ts@ka", "test/b.test.ts@kb2"]);
  });

  it("ends, giving a file up at its key when its walk has nothing to store", () => {
    const { context, ledger, set, rows, marker } = setup();
    set(A, "ka", ca);
    const bare: RunnerClosure = { testFile: B, paths: [B.path] };
    set(B, "kb", bare);
    const rewalk = new ImportRewalk(VERSION);
    rewalk.apply(context, ledger, rewalk.next(context, ledger) ?? [], [ca, bare], new Set());
    expect(rewalk.next(context, ledger)).toBeNull();
    expect(rows()).toEqual(["test/a.test.ts@ka"]);
    expect(marker()).toBe(VERSION);
  });
});
