import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStoppedMark, leaveStoppedMark, stopTree } from "../../src/cli/stopped-mark.js";
import type { EnsureDaemonOptions } from "../../src/core/daemon/ensure.js";
import { stoppedMetaKey } from "../../src/core/delivery/stopped.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { git, tempDir } from "../hash/git-repo.js";
import type { FakeRepo } from "../status/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

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

/** A real git repository with one commit and a linked worktree, as `squealRepo` lays out. */
function gitRepo(): FakeRepo {
  const dir = tempDir("squeal-stopped-");
  cleanups.push(dir.cleanup);
  const main = join(realpathSync(dir.path), "main");
  mkdirSync(main);
  git(main, ["init", "-q"]);
  writeFileSync(join(main, "a.txt"), "a\n");
  git(main, ["add", "a.txt"]);
  git(main, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
  return {
    commonDir: join(main, ".git"),
    main,
    mainId: worktreeIdFor(main as AbsolutePath),
    addWorktree(name) {
      const root = join(realpathSync(dir.path), name);
      git(main, ["worktree", "add", "-q", root]);
      return { root, id: worktreeIdFor(root as AbsolutePath) };
    },
  };
}

function recording() {
  const calls: (EnsureDaemonOptions & { root: string })[] = [];
  const deps: HookDeps = {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    ensureDaemon: async (root, options) => {
      calls.push({ root, ...options });
      return "spawned";
    },
  };
  return { calls, deps };
}

const text = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

/** A registered consumer whose daemon `squeal stop` stopped: record cleared, mark left. */
async function stopped(): Promise<SquealRepo> {
  const r = squealRepo(gitRepo());
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), recording().deps);
  r.store.worktrees.setDaemon(r.worktreeId, null);
  expect(
    leaveStoppedMark(
      r.root as AbsolutePath,
      Date.now() + 1,
      await stopTree(r.root as AbsolutePath),
    ),
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
    const repo = gitRepo();
    const r = squealRepo(repo);
    r.apply(r.pass());
    const linked = repo.addWorktree("linked");
    expect(r.store.worktrees.get(linked.id)).toBeNull();
    expect(
      leaveStoppedMark(
        linked.root as AbsolutePath,
        Date.now() + 1,
        await stopTree(linked.root as AbsolutePath),
      ),
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

  it("starts one after a second edit of a file the stop found modified", async () => {
    const r = squealRepo(gitRepo());
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
