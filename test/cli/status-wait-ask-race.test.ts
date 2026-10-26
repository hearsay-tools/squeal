import { describe, expect, it } from "vitest";
import { namedWaitCommand } from "../../src/cli/named-print.js";
import { readRetries } from "../../src/core/retry/index.js";
import type { CheckKey, RevisionNumber, Store } from "../../src/core/types/index.js";
import { state } from "../status/helpers.js";
import { daemon, HOLDS, inheritedStale, KEY, row, take } from "./status-wait-ask-fixture.js";
import { A, ADDS, NOW, ref, repoWith } from "./status-wait-fixture.js";
import { capture } from "./status-wait-focus-fixture.js";

/*
 * Review 0.1.322 B1 (011 C15's 011-207 amendment: "the check and the write
 * are one transaction"): what changes between the wait's decided read and
 * its write is read again in the write's transaction. A file another
 * worktree now runs at its key, or one now queued, current or at a new key,
 * gets no request, and the wait neither holds for it as asked nor reports it.
 */

/** Another worktree, its daemon live, running A at `KEY`: a claim of the key (C7). */
function claim(store: Store, repo: ReturnType<typeof repoWith>["repo"]) {
  const other = repo.addWorktree("other");
  store.worktrees.upsert({
    id: other.id,
    root: other.root,
    commonDir: repo.commonDir,
    isMain: false,
    registeredAt: 2,
    daemon: {
      socketPath: "/tmp/other.sock",
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    },
  });
  row(store, other.id, "running");
}

/** A passed at `KEY`: current. */
function current(store: Store, worktreeId: string) {
  store.knownStates.upsertMany([ADDS, HOLDS].map((c) => state(worktreeId, c, { observedAt: 4 })));
}

/** A re-keyed with nothing queued: stale at a key the read did not see. */
function rekey(store: Store, worktreeId: string) {
  store.testFileKeys.upsertMany([
    {
      worktreeId,
      testFile: ref(A),
      key: "key-a-next" as CheckKey,
      revision: 4 as RevisionNumber,
      pending: null,
    },
  ]);
}

async function raced(change: (store: Store, repo: ReturnType<typeof repoWith>["repo"]) => void) {
  const { repo, store } = repoWith([]);
  inheritedStale(store, repo.mainId);
  const d = daemon([], 300, () => change(store, repo));
  const io = capture(repo.main);
  const code = await namedWaitCommand([A], { json: true }, io, d.options);
  const json = JSON.parse(io.out.join(""));
  return { code, json, err: io.err.join(""), store, asks: d.asks };
}

describe("a change between the named wait's read and its write asks nothing (review 0.1.322 B1)", () => {
  it("another worktree's claim of the key", async () => {
    const { code, json, err, store, asks } = await raced(claim);

    expect(asks).toEqual([[ref(A)]]);
    expect(readRetries(store)).toEqual([]);
    expect(code).toBe(3);
    expect(json.selection.outcome).toBe("settled");
    expect(json.selection.asked).toBeUndefined();
    expect(json.wait.asked).toBeUndefined();
    expect(err).not.toContain("Run asked");
    expect(err).toContain("'s run of its key");
  });

  it("the file queued at its key", async () => {
    const { code, json, err, store } = await raced((s, repo) => take(s, repo.mainId));

    expect(readRetries(store)).toEqual([]);
    expect(code).toBe(3);
    expect(json.selection).toMatchObject({ outcome: "timeout", testFiles: [{ state: "pending" }] });
    expect(json.selection.asked).toBeUndefined();
    expect(err).not.toContain("Run asked");
    expect(err).not.toContain("run asked by this wait");
  });

  it("a current result at its key", async () => {
    const { code, json, store } = await raced((s, repo) => current(s, repo.mainId));

    expect(readRetries(store)).toEqual([]);
    expect(code).toBe(0);
    expect(json.selection.asked).toBeUndefined();
  });

  it("a new key", async () => {
    const { code, json, err, store } = await raced((s, repo) => rekey(s, repo.mainId));

    expect(readRetries(store)).toEqual([]);
    expect(code).toBe(3);
    expect(json.selection).toMatchObject({ outcome: "settled", testFiles: [{ state: "stale" }] });
    expect(json.selection.asked).toBeUndefined();
    expect(err).not.toContain("Run asked");
  });

  it("the file still as the read found it gets its request", async () => {
    const { json, store } = await raced(() => {});

    expect(readRetries(store)).toMatchObject([{ testFile: ref(A), key: KEY, end: null }]);
    expect(json.selection.asked).toEqual([{ project: "", path: A, pending: true }]);
  });
});
