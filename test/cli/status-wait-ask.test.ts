import { describe, expect, it } from "vitest";
import type { AskNamed } from "../../src/cli/status-wait-ask.js";
import { namedWaitCommand } from "../../src/cli/status-wait-paths.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { endRetries, readRetries } from "../../src/core/retry/index.js";
import type { CheckKey, RevisionNumber } from "../../src/core/types/index.js";
import { daemon, inheritedStale, KEY, pass, row, take } from "./status-wait-ask-fixture.js";
import { A, B, NOW, ref, repoWith } from "./status-wait-fixture.js";
import { capture } from "./status-wait-focus-fixture.js";

/*
 * Row 011-207 (gh-82; 011 C15 and 005 D2 as amended 2026-10-25): a named
 * wait asks one run of each test file named by its own path that is stale
 * or unknown with nothing queued, no other worktree's claim of its key and
 * no request kept at its key, as `squeal retry` with no reason does, and
 * holds for it as pending. A source path's selection asks nothing.
 */

describe("a named wait asks one run of a named file nothing queues (row 011-207)", () => {
  it("an inherited pass made stale: one wait asks its run, holds for it and exits 0", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
    const d = daemon([() => take(store, repo.mainId), () => pass(store, repo.mainId)]);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false }, io, d.options);

    expect(code).toBe(0);
    const text = io.out.join("");
    expect(text).toContain(
      `Run asked: ${A} was stale with nothing queued, so this wait asked its one run at these inputs, as \`squeal retry ${A}\` does.\n`,
    );
    expect(text).toContain("Named test files at revision 4: no known failures");
    expect(readRetries(store)).toMatchObject([
      { testFile: ref(A), key: KEY, session: "s1", noResult: true, end: { outcome: "passed" } },
    ]);
    // Promoted once the daemon queued it: a promotion holds only files queued when it comes.
    expect(d.promoted.flat()).toContainEqual(ref(A));
  });

  it("a source path's selection asks nothing and keeps its verdict", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
    store.testFiles.put({
      testFile: ref(A),
      closure: {
        testFile: ref(A),
        paths: [A, "src/a.ts"] as never,
        complete: false,
        method: CLOSURE_METHOD,
      },
      updatedAt: NOW,
      updatedBy: repo.mainId,
    });
    const d = daemon([]);
    const io = capture(repo.main);

    const code = await namedWaitCommand(["src/a.ts"], { json: true }, io, d.options);

    expect(code).toBe(3);
    expect(d.asks).toEqual([]);
    expect(readRetries(store)).toEqual([]);
    const selection = JSON.parse(io.out.join("")).selection;
    expect(selection).toMatchObject({ outcome: "settled", testFiles: [{ state: "stale" }] });
    expect(selection.asked).toBeUndefined();
  });

  it("a second wait at the same key asks no second run", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
    // The first wait's run ended with no result: A is still stale at its key.
    const ended = () =>
      endRetries(store, ref(A), KEY, { outcome: "unknown", at: NOW, worktreeId: repo.mainId });
    const first = daemon([ended]);
    await namedWaitCommand([A], { json: false }, capture(repo.main), first.options);
    const second = daemon([]);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true }, io, second.options);

    expect(code).toBe(3);
    expect(first.asks).toEqual([[ref(A)]]);
    expect(second.asks).toEqual([]);
    expect(readRetries(store)).toHaveLength(1);
    expect(JSON.parse(io.out.join("")).selection.outcome).toBe("settled");
  });

  it("a file under another worktree's claim of its key is not asked for", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
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
    const d = daemon([]);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false }, io, d.options);

    expect(code).toBe(3);
    expect(d.asks).toEqual([]);
    expect(readRetries(store)).toEqual([]);
    expect(io.out.join("")).toContain(`waiting for ${other.root}'s run of its key`);
  });

  it("a wait that times out before the run ends says the run was asked and is pending", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
    const d = daemon([() => take(store, repo.mainId)], 300);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true }, io, d.options);

    expect(code).toBe(3);
    const selection = JSON.parse(io.out.join("")).selection;
    expect(selection).toMatchObject({
      outcome: "timeout",
      reason: "pending",
      testFiles: [{ path: A, state: "pending" }],
      asked: [{ project: "", path: A, pending: true }],
    });
    expect(io.err.join("")).toContain(
      `Run asked: ${A} was stale with nothing queued, so this wait asked its one run at these inputs, as \`squeal retry ${A}\` does; the run is pending.\n`,
    );
  });

  it("a request the daemon has not taken by the deadline reads as asked, not as nothing queued", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
    const d = daemon([], 300);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false }, io, d.options);

    expect(code).toBe(3);
    const text = io.out.join("");
    expect(text).toContain(
      `; the run is pending: the daemon has not taken the request yet.\nPending (1):\n  1 run asked by this wait; the daemon has not queued it yet: ${A}\n`,
    );
    expect(text).not.toContain("nothing queued it");
    expect(text).toContain("Named test files have no verdict: the deadline passed");
  });
  it("several files: one line names each and the runs still pending", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
    // B keyed, never run: unknown.
    store.testFileKeys.upsertMany([
      {
        worktreeId: repo.mainId,
        testFile: ref(B),
        key: "key-b-now" as CheckKey,
        revision: 4 as RevisionNumber,
        pending: null,
      },
    ]);
    const d = daemon([], 300);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A, B], { json: false }, io, d.options);

    expect(code).toBe(3);
    expect(d.asks).toEqual([[ref(A), ref(B)]]);
    expect(io.out.join("")).toContain(
      `Run asked: 2 test files were stale or unknown with nothing queued, so this wait asked one run of each at these inputs, as \`squeal retry\` does: ${A}, ${B}; 2 runs are pending: ${A}, ${B}.\n`,
    );
  });

  it("a store busy past the bound: nothing asked, nothing held, and the command that asks it", async () => {
    const { repo, store } = repoWith([]);
    inheritedStale(store, repo.mainId);
    const busy: AskNamed = async (_root, files) => files.map((f) => ({ ...f, answer: "busy" }));
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true }, io, {
      ...daemon([]).options,
      ask: busy,
    });

    expect(code).toBe(3);
    const selection = JSON.parse(io.out.join("")).selection;
    expect(selection).toMatchObject({ outcome: "settled", testFiles: [{ state: "stale" }] });
    expect(selection.asked).toEqual([{ project: "", path: A, pending: false }]);
    expect(io.err.join("")).toContain(
      `Run not asked: ${A}: the store stayed busy; \`squeal retry ${A}\` asks it.\n`,
    );
  });
});
