import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { readFailureKeys, recordFailureKeys } from "../../src/core/slow/state.js";
import { checkIdentity, createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { check, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Spec 004 D8, review wave 2.5 B1: the state sink records the key each
 * failing state's result was stored under (`failureKeysMetaKey`). Task
 * 004-81 (004 D8 as amended 2026-10-18): an inherited slow failure reads as
 * any file's, with no slow-tier provenance and no artifact. Worktree wt-b
 * runs the slow file at one commit; wt-a inherits its failure.
 */

const SLOW: TestFileRef = { project: "", path: "test/e2e/a.test.ts" };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a", SLOW);
const COMMIT = "abcdef0123456789";

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let at = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-004-25-"));
  store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: join(root, ".git"),
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  liveDaemon(store, WT);
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({ slow: { include: ["test/e2e/**"] }, inputs: { "test/e2e/**": ["dist/**"] } }),
  );
  at = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function revision(): number {
  at = store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: `src/x${at}.ts`, oldHash: null, newHash: "h" }],
  }).number;
  return at;
}

/** wt-b's failing slow run under `key`, with the same failure text. */
function sourceRun(key: string, sourceRevision: number): ResultRecord {
  const r = result(A, "fail", { key, revision: sourceRevision, worktreeId: OTHER, commit: COMMIT });
  const stored = { ...r, provenance: { ...r.provenance, recordedAt: 1_000 * sourceRevision } };
  store.results.putMany([stored]);
  return stored;
}

/**
 * wt-a keys the slow file `key` at a new revision and takes what the store
 * holds (D5 step 3). Its own run failed under the key first, so wt-b's fail
 * stands there (task 001-170: an inherited fail stands once confirmed).
 */
function inherit(key: string): void {
  recordFailureKeys(store, WT, new Map([[checkIdentity(A), key]]));
  const next = revision();
  setKey(store, key, { file: SLOW });
  sink.refresh(WT, next, { checkpointId: null });
}

/** An edit queues the slow file under `key`: wt-a's failure is pending. */
function _queue(key: string): void {
  const next = revision();
  setKey(store, key, { file: SLOW, pending: "queued" });
  sink.refresh(WT, next, { checkpointId: null });
}

async function provenanceLine(): Promise<string | undefined> {
  const d = await delivery.onToolBoundary(C1);
  if (d === null) throw new Error("no delta");
  return formatDelta(d)
    .split("\n")
    .find((line) => line.includes("slow tier") || line.includes("seen by"));
}

/** Registered before the file had a key: no baseline (011-18). */
const SEEN = "first observed: FAIL; no baseline result, may predate your edits;";

describe("an inherited slow failure reads as any file's (004-81)", () => {
  beforeEach(async () => {
    await delivery.register(C1, { atStart: true });
  });

  it("names the worktree it was seen in, and no slow tier or artifact", async () => {
    sourceRun("k1", 1);
    inherit("k1");
    expect(await provenanceLine()).toBe(
      `      ${SEEN} seen by Squeal's run in worktree wt-b at commit abcdef012345, inherited at revision 1`,
    );
  });
});

describe("the failure keys (spec 004 D8)", () => {
  it("records a failing state's key and forgets it once the check passes", () => {
    sourceRun("k1", 1);
    inherit("k1");
    expect([...readFailureKeys(store, WT)]).toEqual([[checkIdentity(A), "k1"]]);
    const next = revision();
    store.results.putMany([result(A, "pass", { key: "k4", revision: next })]);
    setKey(store, "k4", { file: SLOW });
    sink.applyResults(WT, next, [result(A, "pass", { key: "k4", revision: next })], {
      checkpointId: null,
    });
    expect(readFailureKeys(store, WT).size).toBe(0);
  });

  it("keeps the newest 1024 checks, by when their key last changed", () => {
    const id = (n: number) => checkIdentity(check(`t${n}`, SLOW));
    const first = Array.from({ length: 1_000 }, (_, n) => [id(n), `k${n}`] as const);
    recordFailureKeys(store, WT, new Map(first));
    recordFailureKeys(store, WT, new Map([[id(10), "k10b"]]));
    recordFailureKeys(store, WT, new Map([[id(20), "k20"]]));
    const later = Array.from({ length: 100 }, (_, n) => [id(1_000 + n), `k${1_000 + n}`] as const);
    recordFailureKeys(store, WT, new Map(later));
    const kept = readFailureKeys(store, WT);
    expect(kept.size).toBe(1_024);
    expect(kept.get(id(10))).toBe("k10b");
    expect(kept.has(id(20))).toBe(false);
    expect(kept.has(id(76))).toBe(false);
    expect(kept.get(id(77))).toBe("k77");
    expect(kept.get(id(1_099))).toBe("k1099");
  });
});
