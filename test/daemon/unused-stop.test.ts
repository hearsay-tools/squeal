import { appendFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readHeader } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { sessionRootFiles } from "../../src/harness/shared/session-root.js";
import { recorded, SUBAGENT } from "../harness/helpers.js";
import { git } from "../hash/git-repo.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  stopStrays,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Task 001-415 (the human, 2026-10-15; D10 as amended), against real
 * daemons: one whose worktree keeps a consumer registered stops once nothing
 * used it for `daemon.unusedExitMinutes`, and the next hook starts it again;
 * a worktree-isolated subagent's SubagentStop lets its worktree's daemon go
 * while its parent session stays registered elsewhere.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const suite = daemonSuite();
const { fixture, daemon } = suite;

/** 3 s: the daemon checks every 5 s, so the stop comes within about 8 s of the last use. */
const UNUSED = { "squeal.config.json": JSON.stringify({ daemon: { unusedExitMinutes: 0.05 } }) };
const UNUSED_NOTE = /daemon stopped: no edit, run, wait or request for 3 s/;
/** The unused bound under `baseline.onStart: "lookup-only"` (row 011-91). */
const LOOKUP_ONLY = {
  "squeal.config.json": JSON.stringify({
    daemon: { unusedExitMinutes: 0.05 },
    baseline: { onStart: "lookup-only" },
  }),
};
const SILENT = { stdout: "", stderr: "", exitCode: 0 };
const self = () => findHarnessProcess({ ppid: process.pid });

function deps(repo: FixtureRepo): HookDeps {
  return {
    env: repo.env,
    cli: suite.cli,
    harnessProcess: self,
    sessionRoots: sessionRootFiles(repo.env),
  };
}

async function baselineDone(repo: FixtureRepo, worktreeId = repo.worktreeId): Promise<void> {
  await waitFor(
    () =>
      withStore(repo, (store) => {
        const { counts } = readHeader(store, worktreeId);
        return counts.current >= 5 && counts.pending === 0;
      }),
    60_000,
    "the baseline done",
  );
}

const recordOf = (repo: FixtureRepo, worktreeId: string) =>
  withStore(repo, (store) => store.worktrees.get(worktreeId)?.daemon ?? null);

/** Whether every check of `path` is current, passing or failing. */
const current = (repo: FixtureRepo, path: string) =>
  withStore(repo, (store) => {
    const states = store.knownStates.list(repo.worktreeId).filter((s) => s.check.testPath === path);
    return states.length > 0 && states.every((s) => s.validity === "current");
  });

/** The daemon's exit within 30 s, or a throw with its diagnosis. */
async function exitOf(repo: FixtureRepo, spawned: SpawnedProcess) {
  const exit = await Promise.race([
    spawned.exited,
    new Promise<null>((done) => setTimeout(() => done(null), 30_000)),
  ]);
  if (exit === null) throw new Error(`still running\n${diagnose(repo, spawned)}`);
  return exit;
}

describe("the unused stop (task 001-415)", SLOW, () => {
  it("stops a daemon whose consumer stays registered, and the next hook starts it again", async () => {
    const repo = fixture(UNUSED);
    // The hooks' spawn derives the socket from the process's runtime dir.
    vi.stubEnv("XDG_RUNTIME_DIR", repo.runtimeDir);
    const spawned: SpawnedProcess = daemon(repo);
    await waitReady(repo, spawned);
    const d = deps(repo);
    await runHook("session-start", recorded("session-start", repo.root), d);
    await baselineDone(repo);

    expect(await exitOf(repo, spawned)).toEqual({ code: 0, signal: null });
    expect(readNotes(repo).filter((n) => UNUSED_NOTE.test(n))).toHaveLength(1);
    const sessions = withStore(repo, (s) => s.consumers.list(repo.worktreeId));
    expect(sessions).toHaveLength(1);

    // A rest is no news: neither the next prompt nor the boundary that restarts it says so.
    const prompt = await runHook(
      "user-prompt-submit",
      recorded("user-prompt-submit", repo.root),
      d,
    );
    const next = await runHook("post-tool-batch", recorded("post-tool-batch", repo.root), d);
    expect([prompt, next]).toEqual([SILENT, SILENT]);
    // Its front desk answers before its registration commits (review 001-423): wait for both.
    const again = await waitFor(
      async () => {
        const record = recordOf(repo, repo.worktreeId);
        return record !== null && (await ping(record.socketPath, 500)) !== null && record;
      },
      60_000,
      "a daemon registered and serving again",
    );
    expect(again.socketPath).toBe(repo.socketPath);
  });

  it("lookup-only: the edit that wakes the resting daemon runs, the other files stay as they were (row 011-91)", async () => {
    const repo = fixture(LOOKUP_ONLY);
    vi.stubEnv("XDG_RUNTIME_DIR", repo.runtimeDir);
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const d = deps(repo);
    await runHook("session-start", recorded("session-start", repo.root), d);
    expect(await exitOf(repo, spawned)).toEqual({ code: 0, signal: null });
    expect(readNotes(repo).filter((n) => UNUSED_NOTE.test(n))).toHaveLength(1);

    // The agent edits during the rest; its tool boundary starts the next daemon.
    appendFileSync(join(repo.root, "test/plain.test.ts"), "// edited during the rest\n");
    await runHook("post-tool-batch", recorded("post-tool-batch", repo.root), d);
    await waitFor(() => current(repo, "test/plain.test.ts"), 60_000, "the edited file run");
    // The lookup-only hold stands for every file the start did not reach.
    expect(current(repo, "test/math.test.ts")).toBe(false);
  });

  it("a worktree subagent's SubagentStop lets its daemon stop while its parent stays registered", async () => {
    const repo = fixture();
    const linked = join(dirname(repo.root), "agent-a54374d4ee2bc54fb");
    git(repo.root, ["worktree", "add", "-q", "-b", "agent", linked]);
    const agentRoot = realpathSync(linked);
    suite.cleanup(() => void stopStrays(agentRoot).catch(() => {}));
    const agentId = worktreeIdFor(agentRoot);
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const d = deps(repo);

    await runHook("session-start", recorded("session-start", repo.root), d);
    await runHook("session-start", recorded("subagent-start", agentRoot), d);
    await waitFor(() => ping(recordOf(repo, agentId)?.socketPath ?? "", 500), 60_000, "its daemon");
    await baselineDone(repo, agentId);
    await runHook("post-tool-batch", recorded("subagent-post-tool-batch", repo.root), d);
    const own = (worktreeId: string) =>
      withStore(repo, (s) => s.consumers.list(worktreeId).map((c) => c.consumer.agentId));
    expect(own(agentId)).toEqual([SUBAGENT]);

    await runHook("stop", recorded("subagent-stop", repo.root), d);
    expect(own(agentId)).toEqual([]);
    await waitFor(() => recordOf(repo, agentId) === null, 30_000, "its daemon gone");
    expect(own(repo.worktreeId)).toEqual(["main"]);
    expect(await ping(repo.socketPath, 1_000)).not.toBeNull();
  });
});
