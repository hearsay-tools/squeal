import { beforeEach, describe, expect, it, vi } from "vitest";
import { worktreeStatesOf } from "../../src/core/state/file-class.js";
import { openStore } from "../../src/core/store/open.js";
import { ensureWriteMarkers } from "../../src/core/store/write-markers.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { keepStates } from "../../src/harness/shared/stop-states.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-124: one Stop lists the worktree's known states once, for its
 * news, its decision and the turn's end, while no write moves the states
 * marker between them; it lists them again after one.
 */

const lists = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/core/store/repos/states.js", async (original) => {
  const actual = await original<typeof import("../../src/core/store/repos/states.js")>();
  return {
    ...actual,
    createKnownStateRepo: (...args: Parameters<typeof actual.createKnownStateRepo>) => {
      const repo = actual.createKnownStateRepo(...args);
      return {
        ...repo,
        list: (...a: Parameters<typeof repo.list>) => {
          if (a[1] === undefined) lists.count++;
          return repo.list(...a);
        },
      };
    },
  };
});

const deps = (): HookDeps => ({ env: {}, ensureDaemon: async () => "alive" });

/** A registered main agent in a store whose states marker can be trusted. */
async function registered(): Promise<SquealRepo> {
  const r = squealRepo();
  ensureWriteMarkers(r.store);
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), deps());
  return r;
}

/** The full states lists of one Stop. */
async function stopLists(r: SquealRepo): Promise<{ readonly out: string; readonly lists: number }> {
  lists.count = 0;
  const out = await runHook("stop", recorded("stop", r.root), deps());
  return { out: out.stdout, lists: lists.count };
}

beforeEach(() => {
  lists.count = 0;
});

describe("Stop lists the known states once (row 005-124)", () => {
  it("a quiet Stop: news, decision and turn end from one list", async () => {
    const r = await registered();
    const { out, lists } = await stopLists(r);
    expect(out).toBe("");
    expect(lists).toBe(1);
  });

  it("a Stop with news", async () => {
    const r = await registered();
    r.apply(r.fail());
    const { out, lists } = await stopLists(r);
    expect(out).toContain("PASS -> FAIL");
    expect(out).not.toContain('"decision"');
    expect(lists).toBe(1);
  });

  it("a Stop that blocks", async () => {
    const r = await registered();
    r.apply(r.fail());
    r.policy({ stop: { blockOnKnownFailures: true } });
    const { out, lists } = await stopLists(r);
    expect(JSON.parse(out)).toMatchObject({ decision: "block" });
    expect(lists).toBe(1);
  });

  it("lists again after another writer moved the marker, and not before", async () => {
    const r = await registered();
    const { store } = r;
    // The daemon's writes do not pass through the hook's repo: write past it.
    const daemon = store.knownStates;
    keepStates(store);
    const before = store.knownStates.list(r.worktreeId);
    expect(before.map((s) => s.outcome)).toEqual(["pass"]);
    lists.count = 0;
    expect(store.knownStates.list(r.worktreeId)).toBe(before);
    expect(lists.count).toBe(0);

    daemon.upsertMany(before.map((s) => ({ ...s, outcome: "fail" as const })));

    expect(store.knownStates.list(r.worktreeId).map((s) => s.outcome)).toEqual(["fail"]);
    expect(lists.count).toBe(1);
  });

  it("without the marker's triggers, keeps the list until another connection commits (row 025-18)", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    keepStates(r.store);
    lists.count = 0;
    const before = r.store.knownStates.list(r.worktreeId);
    expect(r.store.knownStates.list(r.worktreeId)).toBe(before);
    expect(lists.count).toBe(1);

    // The daemon's state sink commits from its own connection.
    const daemon = openStore(r.repo.commonDir as AbsolutePath);
    if ("reason" in daemon) throw new Error(`no store: ${daemon.reason}`);
    try {
      daemon.knownStates.upsertMany(before.map((s) => ({ ...s, outcome: "fail" as const })));
    } finally {
      daemon.close();
    }

    expect(r.store.knownStates.list(r.worktreeId).map((s) => s.outcome)).toEqual(["fail"]);
    expect(lists.count).toBe(2);
  });

  it("a Stop without the marker's triggers lists the states once (row 025-18)", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.fail());
    const { out, lists } = await stopLists(r);
    expect(out).toContain("PASS -> FAIL");
    expect(lists).toBe(1);
  });

  it("a store a test made without a connection reads in full each time", () => {
    const list = () => {
      lists.count++;
      return [];
    };
    const store = { knownStates: { list } } as unknown as Store;
    keepStates(store);
    lists.count = 0;
    store.knownStates.list("w" as WorktreeId);
    store.knownStates.list("w" as WorktreeId);
    expect(lists.count).toBe(2);
  });

  it("the kept list is frozen and counted once; a fresh list is counted each time (row 025-18)", async () => {
    const r = await registered();
    keepStates(r.store);
    const kept = r.store.knownStates.list(r.worktreeId);
    expect(Object.isFrozen(kept)).toBe(true);
    expect(worktreeStatesOf(kept)).toBe(worktreeStatesOf(kept));
    const fresh = [...kept];
    expect(worktreeStatesOf(fresh)).not.toBe(worktreeStatesOf(fresh));
    expect(worktreeStatesOf(fresh)).toEqual(worktreeStatesOf(kept));
  });
});
