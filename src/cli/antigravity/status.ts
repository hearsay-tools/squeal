import { worktreeIdFor } from "../../core/fs/git-layout.js";
import { withStatusStore } from "../../core/status/open.js";
import type { AbsolutePath } from "../../core/types/common.js";
import { ANTIGRAVITY_DISABLED, ANTIGRAVITY_INSTALL_COMMAND, antigravityPlugin } from "./install.js";

/*
 * Spec 024 D6: Antigravity sets `ANTIGRAVITY_CONVERSATION_ID` in every
 * `run_command` shell, and its hooks register that id as the consumer's
 * session (D2), so `squeal status` run there is where a user learns that
 * Squeal is quiet because its hooks never ran. Wave 0 (2) saw no
 * `ANTIGRAVITY_AGENT` in `-p` hook env, so the line keys on the id alone.
 */

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The line `squeal status` adds when `ANTIGRAVITY_CONVERSATION_ID` is set and
 * no consumer of that conversation is registered in this worktree, or no
 * store exists; `null` otherwise, including when the store cannot be read.
 * As the Codex line (002 review wave 1, S1), it states what is known, and
 * says so when Antigravity has the installed plugin disabled.
 */
export function antigravityStatusLine(cwd: AbsolutePath, env: Env): string | null {
  const conversation = env.ANTIGRAVITY_CONVERSATION_ID;
  if (conversation === undefined || conversation === "") return null;
  const registered = withStatusStore(cwd, {}, ({ store, root }) =>
    store.consumers.list(worktreeIdFor(root)).some((c) => c.consumer.sessionId === conversation),
  );
  if (registered === true) return null;
  if (registered !== false && registered.reason !== "no-store") return null;
  const plugin = antigravityPlugin(env);
  const cause =
    plugin === null
      ? ` No Squeal plugin is in ~/.gemini/config/plugins/squeal: install it with ${ANTIGRAVITY_INSTALL_COMMAND}, then start Antigravity again.`
      : plugin.disabled
        ? ` Its hooks do not run: ${ANTIGRAVITY_DISABLED}.`
        : "";
  return (
    `Antigravity: no Squeal consumer is registered for this conversation in this worktree (ANTIGRAVITY_CONVERSATION_ID ${conversation}). ` +
    "Either Squeal's hooks do not run in it, or none has registered it yet: hooks that ran before " +
    `the store existed register nothing, and the next prompt does.${cause}\n`
  );
}
