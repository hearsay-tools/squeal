import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import {
  failureKeysMetaKey,
  readFailureKeys,
  recordFailureKeys,
  recordSlowArtifacts,
} from "../../src/core/slow/state.js";
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
 * Spec 004 D8, review wave 2.5 B1: a slow failure names the artifact of the
 * run whose result its state holds, found by the key the state sink recorded
 * with that state (`failureKeysMetaKey`), never by a commit or fingerprint.
 * Worktree wt-b runs the slow file twice at one commit, under `k1` declared
 * `dist-a/**` and later under `k2` declared `dist-b/**`, with one failure
 * text; wt-a inherited the first. It stays the first after the second is
 * stored, and after an edit queues the file again.
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

/** wt-b's failing slow run under `key`, declared to test `glob`, with the same failure text. */
function sourceRun(key: string, glob: string, sourceRevision: number): ResultRecord {
  recordSlowArtifacts(store, OTHER, new Map([[key, [glob]]]));
  const r = result(A, "fail", { key, revision: sourceRevision, worktreeId: OTHER, commit: COMMIT });
  const stored = { ...r, provenance: { ...r.provenance, recordedAt: 1_000 * sourceRevision } };
  store.results.putMany([stored]);
  return stored;
}

/** wt-a keys the slow file `key` at a new revision and takes what the store holds (D5 step 3). */
function inherit(key: string): void {
  const next = revision();
  setKey(store, key, { file: SLOW });
  sink.refresh(WT, next, { checkpointId: null });
}

/** An edit queues the slow file under `key`: wt-a's failure is pending. */
function queue(key: string): void {
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

const FROM = "slow tier, Squeal's run in worktree wt-b at commit abcdef012345 saw it, inherited";

describe("an inherited slow failure names its own run's artifact (B1)", () => {
  beforeEach(async () => {
    await delivery.register(C1, { atStart: true });
  });

  it("keeps the inherited run's artifact after a later run at the same commit", async () => {
    sourceRun("k1", "dist-a/**", 1);
    inherit("k1");
    sourceRun("k2", "dist-b/**", 2);
    expect(await provenanceLine()).toBe(
      `      first observed: FAIL, ${FROM} at revision 1, against dist-a/** as of revision 1`,
    );
  });

  it("names the later run's artifact when that is the one inherited (control)", async () => {
    sourceRun("k1", "dist-a/**", 1);
    sourceRun("k2", "dist-b/**", 2);
    inherit("k2");
    expect(await provenanceLine()).toBe(
      `      first observed: FAIL, ${FROM} at revision 1, against dist-b/** as of revision 1`,
    );
  });

  it("keeps it while an edit has the file pending under a new key", async () => {
    sourceRun("k1", "dist-a/**", 1);
    inherit("k1");
    sourceRun("k2", "dist-b/**", 2);
    queue("k3");
    expect(await provenanceLine()).toBe(
      `      first observed: FAIL, ${FROM} at revision 1, against dist-a/** as of revision 1, revision 2 pending`,
    );
  });

  it("says the artifact is unknown for a state recorded before the keys were", async () => {
    sourceRun("k1", "dist-a/**", 1);
    inherit("k1");
    store.meta.set(failureKeysMetaKey(WT), "{}");
    expect(await provenanceLine()).toBe(
      `      first observed: FAIL, ${FROM} at revision 1, declared artifact unknown`,
    );
  });
});

describe("the failure keys (spec 004 D8)", () => {
  it("records a failing state's key and forgets it once the check passes", () => {
    sourceRun("k1", "dist-a/**", 1);
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
