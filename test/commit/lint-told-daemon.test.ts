import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readCommitReport } from "../../src/core/commit/store.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { cursorKey } from "../../src/core/lint/pass/records.js";
import { isLintStoreOpenFailure, openLintStore } from "../../src/core/lint/store/open.js";
import type { LintStore } from "../../src/core/lint/store/types.js";
import { lintStatusLines } from "../../src/core/lint/surface/format.js";
import { lintStatus } from "../../src/core/lint/surface/report.js";
import { lintStoreSource } from "../../src/core/lint/surface/source.js";
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
import { LINT_ON } from "../lint/helpers.js";
import { FakeProvider } from "../lint/pass/helpers.js";

/*
 * Row 019-43 (lessons Round 3 P12; spec 019 D5, 017 D8): with lint only at
 * `commit`, a commit that adds a finding as the agent's last tool call is
 * told by its `FAIL lint:` line once, at the commit's boundary or at Stop,
 * and status says no "linting" once the pass ends. A real daemon (its lint
 * provider the fake, which finds `bad <rule>` lines), a real `git commit`,
 * Claude Code's and Codex's hooks.
 */

const CONFIG = {
  ...CODE_OFF,
  lint: { enabled: true },
  checks: [{ name: "lint", lint: true, at: "commit" }],
};
const FILES = {
  "squeal.config.json": `${JSON.stringify(CONFIG)}\n`,
  "eslint.config.js": "export default [];\n",
  "src/a.js": "ok\n",
  "src/b.js": "ok\n",
  "src/c.js": "ok\n",
};

interface Hooks {
  readonly name: string;
  start(root: string, deps: HookDeps): Promise<unknown>;
  boundary(root: string, deps: HookDeps): Promise<{ stdout: string }>;
  stop(root: string, deps: HookDeps, active: boolean): Promise<{ stdout: string }>;
}

const HOOKS: readonly Hooks[] = [
  {
    name: "claude-code",
    start: (root, deps) => runHook("session-start", recorded("session-start", root), deps),
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

const git = (repo: FixtureRepo, args: string[]) =>
  execFileSync("git", args, { cwd: repo.root, env: repo.env, encoding: "utf8" }).trim();

/** A commit of every change; CI runners have no git identity, so it has its own. */
function commit(repo: FixtureRepo, message: string): string {
  const identity = ["-c", "user.name=squeal", "-c", "user.email=squeal@example.com"];
  git(repo, [...identity, "commit", "-qam", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

/** `fn` over the lint store as a reader opens it; `null` while there is none. */
function withLintStore<T>(repo: FixtureRepo, fn: (store: LintStore) => T): T | null {
  const store = openLintStore(repo.commonDir, LINT_ON, { create: false });
  if (isLintStoreOpenFailure(store)) return null;
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

const outcomeOf = (repo: FixtureRepo, path: string) =>
  withLintStore(
    repo,
    (store) => store.states.list(repo.worktreeId, { paths: [path] })[0]?.outcome ?? null,
  );

/** Status's lint lines, as `squeal status` reads them with no daemon. */
function statusLines(repo: FixtureRepo): string[] {
  const status = lintStatus(lintStoreSource(repo.commonDir, repo.root), repo.worktreeId, null);
  if (status === undefined) throw new Error("no lint status");
  return lintStatusLines(status, "squeal");
}

describe.each(HOOKS)("a commit's lint finding is told once, $name (019-43)", SLOW, (hooks) => {
  it("tells the commit's FAIL lint line once, at its boundary or at Stop; status says no linting", async () => {
    const repo = createFixtureRepo({ files: FILES });
    onTestFinished(repo.cleanup);
    const provider = new FakeProvider();
    const deps: HookDeps = { env: repo.env, ensureDaemon: async () => "alive" };
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      lintProviders: { eslint: () => provider },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;
    await waitFor(
      () => withLintStore(repo, (s) => s.meta.get(cursorKey(repo.worktreeId)) !== null),
      60_000,
      "the first lint keying",
    );
    await hooks.start(repo.root, deps);
    // Held for a commit, nothing lints: status says so by no "linting" (P12).
    expect(provider.calls).toEqual([]);
    expect(statusLines(repo).join("\n")).not.toMatch(/linting/i);

    // The agent's edit, then its commit as its last tool call.
    const before = withStore(repo, (s) => s.revisions.latest(repo.worktreeId)?.number ?? 0);
    appendFileSync(join(repo.root, "src/a.js"), "bad no-undef\n");
    await waitFor(
      () => withStore(repo, (s) => (s.revisions.latest(repo.worktreeId)?.number ?? 0) > before),
      60_000,
      "the edit stored",
    );
    await hooks.boundary(repo.root, deps);
    expect(outcomeOf(repo, "src/a.js"), "never linted at an edit").toBe("pending");
    const sha = commit(repo, "a");
    const told = [textOf((await hooks.boundary(repo.root, deps)).stdout)];
    await waitFor(() => outcomeOf(repo, "src/a.js") === "fail", 60_000, "the commit's lint");
    await waitFor(
      () =>
        withStore(repo, (s) => {
          const report = readCommitReport(s.meta, repo.worktreeId, sha);
          return report !== null && "updated" in report && report.updated === true;
        }),
      60_000,
      "the commit's update",
    );
    told.push(textOf((await hooks.stop(repo.root, deps, false)).stdout));
    told.push(textOf((await hooks.stop(repo.root, deps, true)).stdout));
    told.push(textOf((await hooks.boundary(repo.root, deps)).stdout));

    const lines = told
      .flatMap((text) => text.split("\n"))
      .filter((l) => l.startsWith("FAIL lint:"));
    expect(lines).toEqual(["FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)"]);
    expect(told.join("\n")).toContain(`Commit ${sha.slice(0, 7)}: `);
    expect(provider.calls.flat()).toEqual(["src/a.js"]);
    const status = statusLines(repo).join("\n");
    expect(status).not.toMatch(/linting/i);
    expect(status).toContain("1 file with findings");
  });
});
