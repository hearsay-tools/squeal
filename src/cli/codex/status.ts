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
    `Codex: Squeal's hooks have not run in this session (no consumer for CODEX_SESSION_ID ${session}). ` +
    `If the plugin is installed, ${CODEX_TRUST_STEP}; otherwise run squeal init --harness codex.\n`
  );
}
