import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStoppedMark, leaveStoppedMark, stopTree } from "../../src/cli/stopped-mark.js";
import { stoppedMetaKey } from "../../src/core/delivery/stopped.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { noDaemonLine } from "../cli/stop-lines.js";
import { git } from "../hash/git-repo.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";
import { cli, commit, gitRepo, recording, text } from "./stopped-repo.js";

/*
 * Row 011-254 (gh-104, the human 2026-10-26: "Approve, whole worktree"):
 * after `squeal stop --until-start`, no hook boundary starts a daemon in the
 * worktree, through fast-forwards, checkouts and edits, until `squeal start`.
 * Another worktree keeps its own boundaries. A plain stop still ends at the
 * next tree change (task 011-08).
 */

const MODE =
  "The daemon is stopped until `squeal start` (`squeal stop --until-start`); no edit or Git operation starts one; results are as of revision 1.";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type Boundary = "post-tool-batch" | "stop" | "session-start" | "user-prompt-submit";

const hook = (r: SquealRepo, name: Boundary, deps: HookDeps, cwd = r.root, overrides = {}) =>
  runHook(name, recorded(name, cwd, overrides), deps);

/** SubagentStop, which Claude Code's `stop` hook takes. */
const subagentStop = (r: SquealRepo, deps: HookDeps) =>
  runHook("stop", recorded("subagent-stop", r.root), deps);

/**
 * A registered consumer, its daemon gone, then `squeal stop` with `argv`; a
 * branch `next` one commit ahead, which no stop has seen, to fast-forward to.
 */
async function stoppedWith(argv: string[]): Promise<SquealRepo> {
  const r = squealRepo(gitRepo(cleanups));
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), recording("alive").deps);
  r.store.worktrees.setDaemon(r.worktreeId, null);
  const next = r.repo.addWorktree("next");
  writeFileSync(join(next.root, "b.txt"), "b\n");
  git(next.root, ["add", "b.txt"]);
  commit(next.root, "b");
  const stop = await cli(["stop", ...argv], r.root);
  expect(stop).toEqual({
    code: 0,
    stdout: noDaemonLine(r.root, argv.includes("--until-start")),
    stderr: "",
  });
  return r;
}

const mark = (r: SquealRepo) => r.store.meta.get(stoppedMetaKey(r.worktreeId));

describe("`squeal stop --until-start` (row 011-254)", () => {
  it("starts no daemon at any boundary through a fast-forward, a checkout and an edit, and names the mode", async () => {
    const r = await stoppedWith(["--until-start"]);
    const { calls, deps } = recording();

    git(r.root, ["merge", "-q", "--ff-only", "next"]);
    const batch = await hook(r, "post-tool-batch", deps);
    await hook(r, "stop", deps);
    git(r.root, ["checkout", "-q", "HEAD~1"]);
    await subagentStop(r, deps);
    writeFileSync(join(r.root, "a.txt"), "edited\n");
    await hook(r, "post-tool-batch", deps);
    await hook(r, "user-prompt-submit", deps);
    const start = await hook(r, "session-start", deps, r.root, { session_id: "another" });

    expect(calls).toEqual([]);
    expect(text(batch)).toMatch(
      /^SQUEAL · the daemon is stopped until `squeal start` at revision 1\n/,
    );
    expect(text(batch)).toContain(MODE);
    expect(text(start)).toContain(MODE);
    expect(text(start)).not.toContain("hold --");
    expect(JSON.parse(mark(r) ?? "null")).toMatchObject({ untilStart: true });
    // No daemon ran, so no edit was recorded or queued.
    expect(r.store.worktrees.get(r.worktreeId)?.daemon).toBeNull();
    expect(text(start)).toMatch(/^SQUEAL · registered at revision 1\n/);
  });

  it("is named by status, plain, `--full` and `--json`", async () => {
    const r = await stoppedWith(["--until-start"]);
    git(r.root, ["merge", "-q", "--ff-only", "next"]);

    const plain = await cli(["status"], r.root);
    const full = await cli(["status", "--full"], r.root);
    const json = JSON.parse((await cli(["status", "--json"], r.root)).stdout);

    expect(plain.stdout).toMatch(
      /; stopped until `squeal start` \(`squeal stop --until-start`\): no edit or Git operation starts one; `squeal start` starts one$/m,
    );
    expect(full.stdout).toContain(
      "\nDaemon: stopped until `squeal start` (`squeal stop --until-start`); no edit or Git operation starts one; run `squeal start` to validate again\n",
    );
    expect(json.daemon).toMatchObject({ state: "down", stopped: true, untilStart: true });
  });

  it("is not ended by a daemon's heartbeat after it, and a plain stop keeps it", async () => {
    const r = squealRepo(gitRepo(cleanups));
    const root = r.root as AbsolutePath;
    const now = Date.now();
    expect(leaveStoppedMark(root, now - 60_000, await stopTree(root), true).error).toBeNull();
    // A daemon a racing hook spawned (row 011-20) heartbeat after the mark, then stopped.
    r.daemon("stale", now - 30_000);
    const { calls, deps } = recording();

    await hook(r, "post-tool-batch", deps);
    const plain = await cli(["stop"], r.root);
    writeFileSync(join(r.root, "a.txt"), "edited\n");
    await hook(r, "post-tool-batch", deps);

    expect(calls).toEqual([]);
    expect(plain.stdout).toBe(noDaemonLine(r.root, true));
    expect(JSON.parse(mark(r) ?? "null")).toMatchObject({ untilStart: true });
  });

  it("ends at `squeal start`, and the next boundary ensures a daemon", async () => {
    const r = await stoppedWith(["--until-start"]);
    const { calls, deps } = recording();
    await hook(r, "post-tool-batch", deps);
    expect(calls).toEqual([]);

    expect(clearStoppedMark(r.root as AbsolutePath)).toBeNull();
    await hook(r, "post-tool-batch", deps);

    expect(mark(r)).toBeNull();
    expect(calls).toEqual([expect.objectContaining({ root: r.root })]);
  });

  it("holds in its own worktree only", async () => {
    const r = await stoppedWith(["--until-start"]);
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
    expect(calls.map((call) => call.root)).toEqual([other.root]);

    // The other worktree's own mode, and this one's start: only this one ensures.
    expect((await cli(["stop", "--until-start"], other.root)).code).toBe(0);
    expect(clearStoppedMark(r.root as AbsolutePath)).toBeNull();
    writeFileSync(join(other.root, "a.txt"), "edited\n");
    await hook(r, "post-tool-batch", deps, other.root);
    await hook(r, "post-tool-batch", deps);
    expect(calls.map((call) => call.root)).toEqual([other.root, r.root]);
  });
});

describe("a plain `squeal stop` (task 011-08, unchanged by row 011-254)", () => {
  it("ends at the fast-forward the mode holds through", async () => {
    const r = await stoppedWith([]);
    const { calls, deps } = recording();
    await hook(r, "post-tool-batch", deps);
    expect(calls).toEqual([]);

    git(r.root, ["merge", "-q", "--ff-only", "next"]);
    await hook(r, "post-tool-batch", deps);

    expect(calls).toEqual([expect.objectContaining({ root: r.root })]);
    expect(mark(r)).toBeNull();
  });
});
