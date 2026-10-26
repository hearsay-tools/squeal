import { describe, expect, it } from "vitest";
import { namedWaitCommand } from "../../src/cli/named-print.js";
import type { SyncState } from "../../src/cli/status-sync.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { catchUpRepo, catchUpSide } from "../scheduler/catch-up-fixture.js";
import { focus, focusedRows, focusing as focusingSide } from "../scheduler/focused-fixture.js";
import { check, state } from "../status/helpers.js";
import { result } from "../store/helpers.js";
import { A, ADDS, key, repoWith } from "./status-wait-fixture.js";
import { A_DONE, capture, focusing } from "./status-wait-focus-fixture.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23; review 0.1.286 B6): the
 * named wait's verdict comes early only for a file current at its key
 * before any focused run. An unknown or stale file that nothing queues,
 * as a lookup-only start leaves it, gets its focus request and its wait.
 */

const GOOD = { key: A_DONE, texts: ["good"], fails: [], passes: ["good"] } as const;

describe("a focused wait on a file nothing queues (review 0.1.286 B6)", () => {
  it("an unknown file: one focus request, then the focused answer", async () => {
    const { repo, store } = repoWith([]);
    // A keyed with nothing queued and no check of its own: unknown.
    key(store, repo.mainId, A, null);
    const daemon = focusing(store, repo.mainId, GOOD);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true, checks: ["good"] }, io, daemon.options);

    expect(code).toBe(3);
    expect(daemon.sent).toHaveLength(1);
    const selection = JSON.parse(io.out.join("")).selection;
    expect(selection.outcome).toBe("focused");
    expect(selection.focused.testFiles[0]).toMatchObject({
      path: A,
      source: "focused",
      checks: [{ name: `${A} > good`, outcome: "pass" }],
    });
  });

  it("a stale file whose result is at its old key: the same", async () => {
    const { repo, store } = repoWith([], [A]);
    store.knownStates.upsertMany(
      [ADDS, check(A, "holds")].map((c) => state(repo.mainId, c, { validity: "stale" })),
    );
    store.results.putMany([result(check(A, "good"), "key-old" as never)]);
    const daemon = focusing(store, repo.mainId, GOOD);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true, checks: ["good"] }, io, daemon.options);

    expect(code).toBe(3);
    expect(daemon.sent).toHaveLength(1);
    expect(JSON.parse(io.out.join("")).selection.outcome).toBe("focused");
  });

  it("an older daemon still gives the named verdict of an unknown file at once", async () => {
    const { repo, store } = repoWith([]);
    key(store, repo.mainId, A, null);
    const daemon = focusing(store, repo.mainId, null, "refused");
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true, checks: ["good"] }, io, daemon.options);

    expect(code).toBe(3);
    expect(daemon.sent).toHaveLength(1);
    expect(JSON.parse(io.out.join("")).selection.outcome).toBe("settled");
  });
});

describe("after a real lookup-only start (review 0.1.286 B6)", { timeout: 60_000 }, () => {
  it("the wait asks the scheduler, which runs the selected check alone and stores nothing", async () => {
    const F = "test/f.test.ts";
    const files = [{ path: F, ms: 1, imports: [] }];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 2,
      policy: { baseline: { onStart: "lookup-only" } },
    });
    focusingSide(side);
    await side.scheduler.start();
    await side.scheduler.idle();
    // Lookup-only: F has a key, no result and nothing queued.
    expect(side.runner.runs).toEqual([]);
    const [row] = side.store.testFileKeys.list(side.worktreeId as never);
    expect(row).toMatchObject({ pending: null });
    const revision = side.store.revisions.latest(side.worktreeId as never)?.number ?? 0;
    const synced = (): SyncState => ({
      state: "synced",
      revision: revision as RevisionNumber,
      incarnation: null,
    });
    const sent: string[][] = [];
    const io = capture(side.root);

    const code = await namedWaitCommand([F], { json: true, checks: ["runs"] }, io, {
      timeoutMs: 30_000,
      pollMs: 20,
      settleMs: 100,
      now: () => Date.now() as EpochMs,
      sync: () => ({ current: synced, stop: () => {} }),
      promote: (_root, refs, withinMs) => void side.scheduler.promote(refs, withinMs),
      focus: async (_root, refs, texts, withinMs) => {
        sent.push([...texts]);
        await focus(side, refs, texts, withinMs);
        return "accepted";
      },
    });

    expect(code).toBe(3);
    expect(sent).toEqual([["runs"]]);
    const selection = JSON.parse(io.out.join("")).selection;
    expect(selection.outcome).toBe("focused");
    expect(selection.focused.testFiles[0]).toMatchObject({
      path: F,
      checks: [{ outcome: "pass" }],
    });
    expect(focusedRows(side)).toMatchObject([{ end: "completed", matched: 1 }]);
    expect(side.store.results.byKey(row?.key ?? null)).toEqual([]);
  });
});
