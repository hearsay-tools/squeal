import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureWriteMarkers } from "../../src/core/store/write-markers.js";
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

  it("reads in full each time without the marker's triggers", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    keepStates(r.store);
    lists.count = 0;
    r.store.knownStates.list(r.worktreeId);
    r.store.knownStates.list(r.worktreeId);
    expect(lists.count).toBe(2);
  });
});
