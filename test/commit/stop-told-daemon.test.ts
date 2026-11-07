import { execFileSync } from "node:child_process";
import { appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readCommitReport, readCommitReports } from "../../src/core/commit/store.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { readCommitLine } from "../../src/core/state/groups.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { runCodexHook } from "../../src/harness/codex/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  waitFor,
  withStore,
} from "../daemon/helpers.js";
import { codexRecorded } from "../harness/codex/helpers.js";
import { recorded } from "../harness/helpers.js";
import { CODE_OFF } from "../helpers/policy.js";

/*
 * Row 019-38 (lessons Round 2 P8, the human's option A; spec 019 D5): a
 * commit line or update that no tool boundary told is told by the next
 * Stop, once, as news; the Stop after it does not repeat it. A real daemon,
 * a real `git commit`, Claude Code's and Codex's hooks.
 */

/** The slow test file, in a group at `commit`: only such files count as a commit's running work (019-28). */
const SLOW_PATH = "test/slow-math.test.ts";
const CHECKS = { checks: [{ name: "ci", runner: "vitest", tests: [SLOW_PATH], at: "commit" }] };

/** A test file of `src/math.ts` that runs for 3 s, so a commit's report waits for it. */
const SLOW_TEST = `import { expect, it } from "vitest";
import { add } from "../src/math.ts";

it("adds slowly", async () => {
  await new Promise((done) => setTimeout(done, 3_000));
  expect(add(1, 2)).toBe(3);
});
`;

interface Hooks {
  readonly name: string;
  start(root: string, deps: HookDeps): Promise<unknown>;
  prompt(root: string, deps: HookDeps): Promise<unknown>;
  boundary(root: string, deps: HookDeps): Promise<{ stdout: string }>;
  stop(root: string, deps: HookDeps, active: boolean): Promise<{ stdout: string }>;
}

const HOOKS: readonly Hooks[] = [
  {
    name: "claude-code",
    start: (root, deps) => runHook("session-start", recorded("session-start", root), deps),
    prompt: (root, deps) =>
      runHook("user-prompt-submit", recorded("user-prompt-submit", root), deps),
    boundary: (root, deps) =>
      runHook(
        "post-tool-batch",
        recorded("post-tool-batch", root, {
          tool_calls: [{ tool_name: "Bash", tool_input: {}, tool_use_id: "t1" }],
        }),
        deps,
      ),
    stop: (root, deps, active) =>
      runHook("stop", recorded("stop", root, { stop_hook_active: active }), deps),
  },
  {
    name: "codex",
    start: (root, deps) =>
      runCodexHook("session-start", codexRecorded("exec", "session-start", root), deps),
    prompt: (root, deps) =>
      runCodexHook("user-prompt-submit", codexRecorded("exec", "user-prompt-submit", root), deps),
    boundary: (root, deps) =>
      runCodexHook("post-tool-use", codexRecorded("exec", "post-tool-use", root), deps),
    stop: (root, deps, active) =>
      runCodexHook("stop", codexRecorded("exec", "stop", root, { stop_hook_active: active }), deps),
  },
];

/** A hook's text: Claude Code's context or a block's reason (Codex's news at Stop). */
function textOf(stdout: string): string {
  if (stdout.trim() === "") return "";
  const out = JSON.parse(stdout) as {
    reason?: string;
    hookSpecificOutput?: { additionalContext?: string };
  };
  return out.reason ?? out.hookSpecificOutput?.additionalContext ?? "";
}

/** How many lines of `text` are the line of the commit `sha`. */
function commitLines(text: string, sha: string): number {
  return text.split("\n").filter((l) => l.startsWith(`Commit ${sha.slice(0, 7)}:`)).length;
}

const git = (repo: FixtureRepo, args: string[]) =>
  execFileSync("git", args, { cwd: repo.root, env: repo.env, encoding: "utf8" }).trim();

/** A commit of every change; CI runners have no git identity, so it has its own. */
function commit(repo: FixtureRepo, message: string): string {
  const identity = ["-c", "user.name=squeal", "-c", "user.email=squeal@example.com"];
  git(repo, [...identity, "commit", "-qam", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

/** The latest revision once it is past `before`. */
async function edited(repo: FixtureRepo, path: string, before: number): Promise<number> {
  appendFileSync(join(repo.root, path), `\nexport const edited${before} = 1;\n`);
  return waitFor(
    () => {
      const latest = withStore(repo, (s) => s.revisions.latest(repo.worktreeId)?.number ?? 0);
      return latest > before ? latest : null;
    },
    60_000,
    "the edit stored",
  );
}

/** Whether every test file of the edit moment ran: the commit group's file waits for a commit. */
const editsRan = (repo: FixtureRepo) =>
  withStore(repo, (s) =>
    s.testFileKeys
      .list(repo.worktreeId)
      .every((k) => k.pending === null || k.testFile.path === SLOW_PATH),
  );

describe.each(HOOKS)(
  "Stop tells a commit line or update no boundary told, once, $name (019-38)",
  SLOW,
  (hooks) => {
    it("the line after a boundary that missed it, then an update stored after the line was told", async () => {
      const repo = createFixtureRepo({
        files: {
          "squeal.config.json": `${JSON.stringify({ ...CODE_OFF, ...CHECKS })}\n`,
          [SLOW_PATH]: SLOW_TEST,
        },
      });
      onTestFinished(repo.cleanup);
      const deps: HookDeps = { env: repo.env, ensureDaemon: async () => "alive" };
      const daemon = await startDaemon({ root: repo.root, env: repo.env });
      if ("reason" in daemon) throw new Error(daemon.message);
      onTestFinished(async () => {
        await daemon.stop("stop-requested");
      });
      await daemon.ready;
      await hooks.start(repo.root, deps);
      const socket = withStore(repo, (s) => s.worktrees.get(repo.worktreeId)?.daemon?.socketPath);
      if (socket === undefined) throw new Error("no daemon socket");
      const reported = () =>
        withStore(repo, (s) => readCommitReports(s.meta, repo.worktreeId)?.seen);

      // An edit whose test files ran and were told, so the commit is the next news.
      const first = await edited(repo, "src/strings.ts", 0);
      await waitFor(() => editsRan(repo), 60_000, "the edit's runs");
      await hooks.boundary(repo.root, deps);
      const a = commit(repo, "strings");
      // The commit's boundary gets no answer from the daemon, as one past its 500 ms bound.
      renameSync(socket, `${socket}.away`);
      const missed = await hooks.boundary(repo.root, deps).finally(() => {
        renameSync(`${socket}.away`, socket);
      });
      expect(reported()).not.toBe(a);
      expect(commitLines(textOf(missed.stdout), a)).toBe(0);
      await requestDaemon(socket as AbsolutePath, { type: "sync" }, 10_000);
      await waitFor(() => reported() === a, 30_000, "the commit's report");

      const stop = textOf((await hooks.stop(repo.root, deps, false)).stdout);
      expect(commitLines(stop, a)).toBe(1);
      expect(commitLines(textOf((await hooks.stop(repo.root, deps, true)).stdout), a)).toBe(0);
      expect(commitLines(textOf((await hooks.boundary(repo.root, deps)).stdout), a)).toBe(0);

      // A commit the commit group's slow file runs for: its boundary tells the line, the update comes later.
      await hooks.prompt(repo.root, deps);
      await edited(repo, "src/math.ts", first);
      await waitFor(() => editsRan(repo), 60_000, "the edit's runs");
      await hooks.boundary(repo.root, deps);
      const b = commit(repo, "math");
      const atCommit = textOf((await hooks.boundary(repo.root, deps)).stdout).split("\n");
      expect(atCommit.filter((l) => l.startsWith(`Commit ${b.slice(0, 7)}:`))).toEqual([
        expect.stringMatching(/; 1 test file still running/),
      ]);
      const updated = () =>
        withStore(repo, (s) => {
          const report = readCommitReport(s.meta, repo.worktreeId, b);
          return report !== null && "updated" in report && report.updated === true;
        });
      await waitFor(updated, 60_000, "the commit's update");
      const update = withStore(repo, (s) => readCommitLine(s, repo.worktreeId))?.text;

      const told = textOf((await hooks.stop(repo.root, deps, false)).stdout);
      expect(told.split("\n").filter((l) => l === update)).toHaveLength(1);
      expect(commitLines(textOf((await hooks.stop(repo.root, deps, true)).stdout), b)).toBe(0);
    });
  },
);
