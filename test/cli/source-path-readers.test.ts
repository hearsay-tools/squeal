import { describe, expect, it } from "vitest";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { readNamedSnapshot } from "../../src/cli/status-paths.js";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { syncRequest } from "../../src/cli/status-sync.js";
import { type NamedWaitOptions, namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { MAX_LINE_BYTES } from "../../src/core/daemon/protocol.js";
import type { Store } from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import {
  ALL,
  answeringReaders,
  daemonReaders,
  keys,
  READERS,
  RUNTIME_READERS,
  SPAWNED,
  START,
  storeClosures,
  TYPES,
} from "./source-path-fixture.js";
import { finish, key, later, NOW, repoWith, timed } from "./status-wait-fixture.js";

/*
 * Row 011-234 (005 D2 as amended, `research/source-path-selection.md`): a
 * named wait's source path selects the test files whose closure in this
 * worktree's key index holds it, as the daemon answers the wait's sync;
 * with no answer, the stored closures valid for this worktree, as before.
 */

/** What `path` selects in W: with the daemon's answer, else by the store rule. */
function selects(store: Store, w: string, root: string, path: string, daemon: boolean) {
  const readers = daemon ? daemonReaders([path]) : undefined;
  const files = selectNamedFiles(store, w, root, root, [path], readers).files.map((f) => f.path);
  return files.filter((f) => READERS.includes(f)).length;
}

const options = (sync: NamedWaitOptions["sync"], timeoutMs = 5_000): NamedWaitOptions => ({
  timeoutMs,
  pollMs: 20,
  settleMs: 100,
  now: () => NOW,
  sync,
});

/** W with every file current; `start-spawned`'s record is X's, whose key for it differs. */
function spawnedFromX() {
  const { repo, store } = repoWith([], ALL);
  const w = repo.mainId;
  const x = repo.addWorktree("other").id;
  storeClosures(
    store,
    ALL.filter((p) => p !== SPAWNED),
    w,
  );
  storeClosures(store, [SPAWNED], x);
  keys(store, x, [SPAWNED], "x1");
  return { repo, store, w };
}

describe("a source path with the daemon's readers (fixture steps)", () => {
  it("selects all 13 readers at S1, S3, S6b and S7b, where the store rule selects none", () => {
    const { repo, store } = repoWith([], ALL);
    const w = repo.mainId;
    const x = repo.addWorktree("other").id;
    const root = repo.main;
    store.testFileKeys.upsertMany(store.testFileKeys.list(w).map((r) => ({ ...r, worktreeId: x })));
    storeClosures(store, ALL, x);
    const step = () => [
      selects(store, w, root, START, true),
      selects(store, w, root, START, false),
    ];
    expect(step()).toEqual([13, 13]);
    // S1: W edits start.ts; its keys move, its runner part has not stored the closures.
    keys(store, w, READERS, "w1");
    expect(step()).toEqual([13, 0]);
    // S3: after W's runner part stored them, X edits types/index.ts and stores all 33.
    storeClosures(store, READERS, w);
    keys(store, x, ALL, "x1");
    storeClosures(store, ALL, x);
    expect(step()).toEqual([13, 0]);
    // S6b: W and X at one content, X wrote all 33, then X moves to another commit.
    keys(store, w, ALL, "c0");
    keys(store, x, ALL, "c0");
    storeClosures(store, ALL, x);
    keys(store, x, ALL, "c1");
    expect(step()).toEqual([13, 0]);
    // S7b: X back at W's content, then pruned: its 33 records stay, its keys go.
    keys(store, x, ALL, "c0");
    store.worktrees.remove(x);
    expect(step()).toEqual([13, 0]);
  });

  it("reads the store rule for a path the answer does not name, and none for a path no closure holds", () => {
    const { repo, store } = repoWith([], ALL);
    const w = repo.mainId;
    storeClosures(store, ALL, w);
    const readers = daemonReaders([START, "src/nothing.ts"]);
    const selection = selectNamedFiles(
      store,
      w,
      repo.main,
      repo.main,
      [START, TYPES, "src/nothing.ts"],
      readers,
    );
    expect(selection.paths).toEqual([
      { path: START, kind: "source", selects: 13 },
      { path: TYPES, kind: "source", selects: 33 },
      { path: "src/nothing.ts", kind: "unmatched", selects: 0 },
    ]);
    expect(selection.unmatched).toEqual(["src/nothing.ts"]);
  });
});

describe("a named wait on a source path (row 011-234)", () => {
  it("exits 1 with a reader failing whose record another worktree wrote; asks readers of the source path only", async () => {
    const { repo, store, w } = spawnedFromX();
    store.knownStates.upsertMany([
      state(w, check(SPAWNED, "holds"), { outcome: "fail", observedAt: 4, fingerprint: "E: x" }),
    ]);
    const daemon = answeringReaders();
    const wait = await waitForNamed(
      repo.main,
      [START, RUNTIME_READERS[0] ?? ""],
      options(daemon.sync),
    );
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait.selection.files.map((f) => f.path)).toContain(SPAWNED);
    expect([wait.outcome, namedCode(wait)]).toEqual(["settled", 1]);
    expect(daemon.asked).toEqual([[START]]);
  });

  it("holds for a queued reader until its result lands", async () => {
    const { repo, store, w } = spawnedFromX();
    key(store, w, SPAWNED, "queued");
    store.knownStates.upsertMany([
      state(w, check(SPAWNED, "holds"), { validity: "pending", pendingPhase: "queued" }),
    ]);
    const finished = later(300, () => finish(store, w, SPAWNED));
    const named = options(answeringReaders().sync);
    const { wait, endedBy } = await timed(() => waitForNamed(repo.main, [START], named));
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(endedBy).toBeGreaterThanOrEqual(finished.at);
    expect([wait.outcome, namedCode(wait), wait.selection.files.length]).toEqual([
      "settled",
      0,
      13,
    ]);
  });

  it("keeps the store rule with an older daemon's answer and with no daemon", async () => {
    const { repo, store, w } = spawnedFromX();
    store.knownStates.upsertMany([
      state(w, check(SPAWNED, "holds"), { outcome: "fail", observedAt: 4, fingerprint: "E: x" }),
    ]);
    const older = await waitForNamed(repo.main, [START], options(answeringReaders(false).sync));
    const none: DaemonSync = { current: () => ({ state: "unsupported" }), stop: () => {} };
    const alone = await waitForNamed(
      repo.main,
      [START],
      options(() => none),
    );
    for (const wait of [older, alone]) {
      if (wait.outcome === "unavailable") throw new Error("unavailable");
      expect(wait.selection.files.map((f) => f.path)).not.toContain(SPAWNED);
      expect([wait.selection.files.length, namedCode(wait)]).toEqual([12, 0]);
    }
  });

  it("selects the daemon's readers in a snapshot too", async () => {
    const { repo, store, w } = spawnedFromX();
    store.knownStates.upsertMany([
      state(w, check(SPAWNED, "holds"), { outcome: "fail", observedAt: 4, fingerprint: "E: x" }),
    ]);
    const daemon = answeringReaders();
    const read = await readNamedSnapshot(repo.main, [START], {
      now: () => NOW,
      settleMs: 100,
      sync: daemon.sync,
    });
    if (read.outcome === "unavailable") throw new Error("unavailable");
    expect([read.selection.files.length, namedCode(read)]).toEqual([13, 1]);
    expect(daemon.asked).toEqual([[START]]);
  });
});

describe("the sync request's paths (row 011-234)", () => {
  it("carries the source paths while the line fits the daemon's bound, else none", () => {
    expect(syncRequest([])).toEqual({ type: "sync" });
    expect(syncRequest([START])).toEqual({ type: "sync", paths: [START] });
    const many = Array.from({ length: 2_000 }, (_, i) => `src/a-long-directory/file-${i}.ts`);
    expect(JSON.stringify({ type: "sync", paths: many }).length).toBeGreaterThan(MAX_LINE_BYTES);
    expect(syncRequest(many)).toEqual({ type: "sync" });
  });
});
