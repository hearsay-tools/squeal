import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStoppedMark, leaveStoppedMark, stopTree } from "../../src/cli/stopped-mark.js";
import { worktreeLiveness } from "../../src/core/delivery/liveness.js";
import { stopHolds, stoppedMetaKey } from "../../src/core/delivery/stopped.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";
import { gitRepo, recording, text } from "./stopped-repo.js";

/*
 * Task 011-08 (gh-22, spec 011 C8 and C9): after `squeal stop`, no hook
 * boundary starts a daemon until the agent edits or `squeal start` runs, and
 * what the hooks deliver says the daemon is stopped by request.
 */

const STOPPED = "The daemon is stopped by request (`squeal stop`)";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A registered consumer whose daemon `squeal stop` stopped: record cleared, mark left. */
async function stopped(): Promise<SquealRepo> {
  const r = squealRepo(gitRepo(cleanups));
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), recording("alive").deps);
  r.store.worktrees.setDaemon(r.worktreeId, null);
  expect(
    leaveStoppedMark(r.root as AbsolutePath, Date.now() + 1, await stopTree(r.root as AbsolutePath))
      .error,
  ).toBeNull();
  return r;
}

const hook = (r: SquealRepo, name: "post-tool-batch" | "stop", deps: HookDeps, cwd = r.root) =>
  runHook(name, recorded(name, cwd), deps);

describe("a hook boundary after `squeal stop` (task 011-08)", () => {
  it("starts no daemon at PostToolBatch or Stop, and the delivered text names the stop", async () => {
    const r = await stopped();
    const { calls, deps } = recording();

    const batch = await hook(r, "post-tool-batch", deps);
    const stop = await hook(r, "stop", deps);
    const again = await hook(r, "post-tool-batch", deps);

    expect(calls).toEqual([]);
    expect(text(batch)).toMatch(/^SQUEAL · the daemon is stopped by request at revision 1\n/);
    expect(text(batch)).toContain(`${STOPPED}; a hook starts one at the next edit`);
    expect(text(batch)).not.toContain("Not validated");
    expect(stop.stdout).toBe("");
    expect(again.stdout).toBe("");
  });

  it("holds in a linked worktree that has no row in the shared store yet (review wave-1.10 B1)", async () => {
    const repo = gitRepo(cleanups);
    const r = squealRepo(repo);
    r.apply(r.pass());
    const linked = repo.addWorktree("linked");
    expect(r.store.worktrees.get(linked.id)).toBeNull();
    expect(
      leaveStoppedMark(
        linked.root as AbsolutePath,
        Date.now() + 1,
        await stopTree(linked.root as AbsolutePath),
      ).error,
    ).toBeNull();
    const { calls, deps } = recording();

    const start = await runHook("session-start", recorded("session-start", linked.root), deps);
    const batch = await hook(r, "post-tool-batch", deps, linked.root);

    expect(calls).toEqual([]);
    expect(text(start)).toContain(STOPPED);
    expect(batch.stdout === "" || text(batch).includes(STOPPED)).toBe(true);
  });

  it("starts none at a registration either, whose header names the stop", async () => {
    const r = await stopped();
    const { calls, deps } = recording();

    const start = await runHook(
      "session-start",
      recorded("session-start", r.root, { session_id: "another-session" }),
      deps,
    );

    expect(calls).toEqual([]);
    expect(text(start)).toContain(`${STOPPED}; a hook starts one at the next edit, or run`);
  });

  it("says a daemon is starting when the stop's mark lands while its SessionStart spawns one (row 011-20)", async () => {
    const r = squealRepo(gitRepo(cleanups));
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), recording("alive").deps);
    // The daemon went, the stop printed its tree before, and the agent edited in the gap.
    r.store.worktrees.setDaemon(r.worktreeId, null);
    const tree = await stopTree(r.root as AbsolutePath);
    writeFileSync(join(r.root, "a.txt"), "edited\n");
    const { calls, deps } = recording();
    const spawning: HookDeps = {
      ...deps,
      ensureDaemon: async (root, options) => {
        // `squeal stop` leaves its mark after the socket went: after this hook found none.
        expect(leaveStoppedMark(root, Date.now() + 1, tree).error).toBeNull();
        return deps.ensureDaemon?.(root, options) ?? "spawned";
      },
    };

    const start = await runHook(
      "session-start",
      recorded("session-start", r.root, { session_id: "another-session" }),
      spawning,
    );
    const batch = await hook(r, "post-tool-batch", deps);

    expect(calls).toHaveLength(2);
    expect(text(start)).toContain("A daemon is starting");
    expect(text(start)).not.toContain(STOPPED);
    expect(text(batch)).not.toContain(STOPPED);
  });

  it("starts one at the first boundary after an edit, and the mark is gone", async () => {
    const r = await stopped();
    const { calls, deps } = recording();
    await hook(r, "post-tool-batch", deps);
    expect(calls).toEqual([]);

    writeFileSync(join(r.root, "a.txt"), "edited\n");
    await hook(r, "post-tool-batch", deps);

    expect(calls).toEqual([expect.objectContaining({ root: r.root })]);
    expect(r.store.meta.get(stoppedMetaKey(r.worktreeId))).toBeNull();
  });

  it("holds when git could not print the tree at the stop, and an edit after the next print clears it (review wave-1.10 B2)", async () => {
    const r = squealRepo(gitRepo(cleanups));
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), recording("alive").deps);
    r.store.worktrees.setDaemon(r.worktreeId, null);
    expect(leaveStoppedMark(r.root as AbsolutePath, Date.now() + 1, null).error).toBeNull();
    const { calls, deps } = recording();

    // Git answers again: its first print is the mark's own, not an edit.
    await hook(r, "post-tool-batch", deps);
    await hook(r, "post-tool-batch", deps);
    expect(calls).toEqual([]);
    expect(r.store.meta.get(stoppedMetaKey(r.worktreeId))).toContain('"tree":"');

    writeFileSync(join(r.root, "a.txt"), "edited\n");
    await hook(r, "post-tool-batch", deps);
    expect(calls).toEqual([expect.objectContaining({ root: r.root })]);
  });

  it("lets a `squeal start` that cleared the mark while git printed the tree win (review wave-1.10 R2)", async () => {
    const r = squealRepo(gitRepo(cleanups));
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), recording("alive").deps);
    r.store.worktrees.setDaemon(r.worktreeId, null);
    expect(leaveStoppedMark(r.root as AbsolutePath, Date.now() + 1, null).error).toBeNull();
    const worktree = r.store.worktrees.get(r.worktreeId);
    const live = worktreeLiveness(worktree, Date.now() as EpochMs);

    // stopHolds awaits git; the start's clear lands in between.
    const holds = stopHolds(
      r.store,
      { id: r.worktreeId, root: r.root as AbsolutePath },
      worktree,
      live,
    );
    expect(clearStoppedMark(r.root as AbsolutePath)).toBeNull();

    expect(await holds).toBe(false);
    expect(r.store.meta.get(stoppedMetaKey(r.worktreeId))).toBeNull();
  });

  it("starts one after a second edit of a file the stop found modified", async () => {
    const r = squealRepo(gitRepo(cleanups));
    writeFileSync(join(r.root, "a.txt"), "first\n");
    r.store.worktrees.setDaemon(r.worktreeId, null);
    leaveStoppedMark(
      r.root as AbsolutePath,
      Date.now() + 1,
      await stopTree(r.root as AbsolutePath),
    );
    const { calls, deps } = recording();
    await hook(r, "post-tool-batch", deps);
    expect(calls).toEqual([]);

    writeFileSync(join(r.root, "a.txt"), "second, longer\n");
    await hook(r, "stop", deps);

    expect(calls).toHaveLength(1);
  });

  it("is cleared by `squeal start`, and the next boundary ensures a daemon", async () => {
    const r = await stopped();
    const { calls, deps } = recording();

    expect(clearStoppedMark(r.root as AbsolutePath)).toBeNull();
    await hook(r, "stop", deps);

    expect(r.store.meta.get(stoppedMetaKey(r.worktreeId))).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("is void once a daemon heartbeats after it", async () => {
    const r = await stopped();
    const now = Date.now();
    leaveStoppedMark(r.root as AbsolutePath, now - 60_000, await stopTree(r.root as AbsolutePath));
    r.daemon("stale", now - 30_000);
    const { calls, deps } = recording();

    await hook(r, "post-tool-batch", deps);

    expect(calls).toHaveLength(1);
  });

  it("leaves a second worktree's daemon to its own boundaries", async () => {
    const r = await stopped();
    const other = r.repo.addWorktree("other");
    r.store.worktrees.upsert({
      id: other.id,
      root: other.root as AbsolutePath,
      commonDir: r.repo.commonDir as AbsolutePath,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    const { calls, deps } = recording();

    await hook(r, "post-tool-batch", deps, other.root);
    await hook(r, "post-tool-batch", deps);

    expect(calls).toEqual([expect.objectContaining({ root: other.root })]);
  });
});
