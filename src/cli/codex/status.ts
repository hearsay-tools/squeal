import { worktreeIdFor } from "../../core/fs/index.js";
import { withStatusStore } from "../../core/status/index.js";
import type { AbsolutePath } from "../../core/types/index.js";
import { CODEX_TRUST_STEP } from "./init.js";

/*
 * Spec 002 D6: Codex skips untrusted hooks silently, so `squeal status` run in
 * a Codex shell is the one place a user learns why Squeal is quiet. The shell
 * sees the thread id as `CODEX_SESSION_ID`, the hooks register it as
 * `session_id` (D2).
 */

/**
 * The line `squeal status` adds when `CODEX_SESSION_ID` is set and no consumer
 * of that session is registered in this worktree, or no store exists; `null`
 * otherwise, including when the store cannot be read.
 *
 * Review wave 1, S1: it states what is known and no cause. In the session
 * that creates the store, its hooks run before the store exists and register
 * nothing, and PreToolUse never registers; the session may be registered in
 * another worktree of the repository (N6). Only then does it name the trust step.
 */
export function codexStatusLine(
  cwd: AbsolutePath,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const session = env.CODEX_SESSION_ID;
  if (session === undefined || session === "") return null;
  const registered = withStatusStore(cwd, {}, ({ store, root }) =>
    store.consumers.list(worktreeIdFor(root)).some((c) => c.consumer.sessionId === session),
  );
  if (registered === true) return null;
  if (registered !== false && registered.reason !== "no-store") return null;
  return (
    `Codex: no Squeal consumer is registered for this session in this worktree (CODEX_SESSION_ID ${session}). ` +
    "Either Squeal's hooks do not run in it, or none has registered it yet: hooks that ran before " +
    "the store existed register nothing, and the next prompt or tool result does. " +
    `If the hooks do not run and the plugin is installed, ${CODEX_TRUST_STEP}; ` +
    "without the plugin, run squeal init --harness codex.\n"
  );
}
