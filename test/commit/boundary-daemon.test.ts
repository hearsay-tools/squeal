import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readCommitReports } from "../../src/core/commit/store.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  waitFor,
  withStore,
} from "../daemon/helpers.js";
import { recorded } from "../harness/helpers.js";
import { CODE_OFF } from "../helpers/policy.js";

/*
 * Row 019-29 (lessons round 1, P2 option a; spec 019 D5): the tool boundary
 * that sees `HEAD` move waits up to 500 ms for the daemon's pass to store
 * the commit's report and carries its line in that same delivery, so an
 * agent whose commit is its last tool call is told. A boundary with no
 * `HEAD` move asks the daemon nothing and waits for nothing. A real daemon,
 * the Claude Code hooks, a real `git commit`.
 */

const CHECKS = { checks: [{ name: "unit", runner: "vitest", tests: ["test/**"], at: "edit" }] };

const contextOf = (stdout: string): string =>
  (JSON.parse(stdout || "{}") as { hookSpecificOutput?: { additionalContext?: string } })
    .hookSpecificOutput?.additionalContext ?? "";

const git = (repo: FixtureRepo, args: string[]) =>
  execFileSync("git", args, { cwd: repo.root, env: repo.env, encoding: "utf8" }).trim();

const bash = (root: string) =>
  recorded("post-tool-batch", root, {
    tool_calls: [{ tool_name: "Bash", tool_input: {}, tool_use_id: "t1" }],
  });

describe("the tool boundary right after a commit, with a real daemon (019-29)", SLOW, () => {
  it("carries the commit line in the same delivery; a boundary with no HEAD move waits for nothing", async () => {
    const repo = createFixtureRepo({
      files: { "squeal.config.json": `${JSON.stringify({ ...CODE_OFF, ...CHECKS })}\n` },
    });
    onTestFinished(repo.cleanup);
    const deps: HookDeps = { env: repo.env, ensureDaemon: async () => "alive" };
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;
    await runHook("session-start", recorded("session-start", repo.root), deps);

    // An edit the daemon stored, told at its boundary, so the next one has only the commit as news.
    const before = withStore(repo, (s) => s.revisions.latest(repo.worktreeId)?.number ?? 0);
    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const edited = 1;\n");
    await waitFor(
      () => withStore(repo, (s) => (s.revisions.latest(repo.worktreeId)?.number ?? 0) > before),
      60_000,
      "the edit stored",
    );
    await runHook("post-tool-batch", bash(repo.root), deps);

    git(repo, ["commit", "-qam", "edited"]);
    const sha = git(repo, ["rev-parse", "HEAD"]);
    const reported = () => withStore(repo, (s) => readCommitReports(s.meta, repo.worktreeId)?.seen);
    // No pass reported it yet: the boundary's own sync pass does.
    expect(reported()).not.toBe(sha);
    const asked = performance.now();
    const commit = await runHook("post-tool-batch", bash(repo.root), deps);
    // The wait is bounded at 500 ms, the hook's timeout is 2 s.
    expect(performance.now() - asked).toBeLessThan(2_000);
    expect(reported()).toBe(sha);
    expect(contextOf(commit.stdout)).toContain(`Commit ${sha.slice(0, 7)}:`);

    // No HEAD move: the boundary asks for no pass, so it cannot wait for one, and says no commit again.
    const started = performance.now();
    const after = await runHook("post-tool-batch", bash(repo.root), deps);
    const elapsed = performance.now() - started;
    expect(contextOf(after.stdout)).not.toContain(`Commit ${sha.slice(0, 7)}`);
    expect(elapsed).toBeLessThan(500);
  });
});
