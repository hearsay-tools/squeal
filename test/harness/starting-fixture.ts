import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach } from "vitest";
import type { DaemonLock } from "../../src/core/daemon/lock.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { buildSnapshot } from "../../src/core/status/snapshot.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookResult } from "../../src/harness/claude-code/run.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { holdStart as holdLockedStart } from "../helpers/start-mark.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Row 005-108: a worktree whose daemon holds its lock in a slow start, driven through the
 * production Claude Code hooks with an injected clock (`starting-no-row.test.ts`,
 * `starting-second-session.test.ts`).
 */

export const T = Date.UTC(2026, 10, 18, 9, 0);

export const locks: DaemonLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
});

export const text = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : ((JSON.parse(out.stdout) as { hookSpecificOutput?: { additionalContext?: string } })
        .hookSpecificOutput?.additionalContext ?? out.stdout);

/** A new worktree: a store, no row for it; one session started at `T`, its spawn answered. */
export async function newWorktree(row: "none" | "cleared" = "none") {
  const r = squealRepo();
  if (row === "none") r.store.worktrees.remove(r.worktreeId);
  else r.daemon("none");
  let clock = T;
  const spawns: number[] = [];
  const deps: HookDeps = {
    env: {},
    now: () => clock,
    ensureDaemon: async () => {
      spawns.push(clock - T);
      return "spawned";
    },
  };
  const start = text(await runHook("session-start", recorded("session-start", r.root), deps));
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  mkdirSync(dirname(lockFile), { recursive: true });
  // `session`: another session's id; `source`: a SessionStart's (`startup`, `resume`).
  const hook = async (
    name: "session-start" | "post-tool-batch" | "stop",
    ms: number,
    input: { readonly session_id?: string; readonly source?: string } = {},
  ) => {
    clock = T + ms;
    return text(await runHook(name, recorded(name, r.root, input), deps));
  };
  const batch = (ms: number, session?: string) =>
    hook("post-tool-batch", ms, session === undefined ? {} : { session_id: session });
  const stop = (ms: number) => hook("stop", ms);
  const sessionStart = (ms: number, input: { session_id?: string; source?: string }) =>
    hook("session-start", ms, input);
  const status = (ms: number) =>
    formatStatus(buildSnapshot(r.store, r.root as AbsolutePath, T + ms), T + ms);
  return { r, start, batch, stop, sessionStart, status, spawns, lockFile };
}

/**
 * The spawned daemon takes the lock and marks its start, as `openDaemon` does before its store
 * check, `ms` after `T` by the mark's time, which readers take as the start's.
 */
export const holdStart = (lockFile: AbsolutePath, ms = 0): DaemonLock =>
  holdLockedStart(lockFile, T + ms);
