import { worktreeIdFor } from "../../core/fs/index.js";
import { withStatusStore } from "../../core/status/index.js";
import { shellWord } from "../../core/text.js";
import type { AbsolutePath } from "../../core/types/index.js";
import { usesSquealAt } from "../../harness/opencode/host.js";
import { INSTALL_SH_COMMAND } from "../pi/status.js";

/*
 * Spec 008 D7: OpenCode sets only `OPENCODE=1` and `OPENCODE_PID` in the
 * agent's shell; the plugin's `shell.env` adds `OPENCODE_SESSION_ID` and
 * `OPENCODE_AGENT_ID` (D2). So `squeal status` in an OpenCode shell can tell
 * a plugin that ran from one that never did.
 */

/**
 * How OpenCode texts name the CLI `cli` (D7), as the bridge's
 * `opencodeCommand` does: the Node running it and the CLI, both by absolute
 * path, quoted for a shell.
 */
export function opencodeCliCommand(cli: string, node: string = process.execPath): string {
  return `${shellWord(node)} --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}

/**
 * The line `squeal status` adds in an OpenCode shell, naming the cause it
 * knows (D7); `null` outside OpenCode, when a consumer of the session is
 * registered in this worktree, or when the store cannot be read. With
 * `OPENCODE_SESSION_ID` set, the plugin ran: as the Codex and Pi lines, it
 * states what is known, since the plugin registers at the session's next
 * user message, one that started before the store existed or failed to
 * register included. With `OPENCODE=1` and no session id, the plugin's
 * `shell.env` never ran in this session. Install is `install.sh`'s, which
 * adds the plugin to OpenCode only when its config does not list it (D1).
 * Either way, a worktree that fails the plugin's own fast path (D4) keeps
 * the plugin off whether installed or not, so that cause comes first
 * (lessons defect 2).
 */
export function opencodeStatusLine(
  cwd: AbsolutePath,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const session = env.OPENCODE_SESSION_ID;
  const ran = session !== undefined && session !== "";
  if (!ran && env.OPENCODE !== "1") return null;
  if (!usesSquealAt(cwd)) {
    return (
      "OpenCode: this repository is not set up for Squeal (no squeal.config.json and no Squeal store), " +
      "so the Squeal OpenCode plugin stays off in it. Run squeal setup, then start OpenCode again.\n"
    );
  }
  if (!ran) {
    return (
      "OpenCode: this shell runs under OpenCode (OPENCODE=1) without OPENCODE_SESSION_ID, " +
      "so the Squeal OpenCode plugin did not run in this session. " +
      `Install it with ${INSTALL_SH_COMMAND}, then start OpenCode again.\n`
    );
  }
  const registered = withStatusStore(cwd, {}, ({ store, root }) =>
    store.consumers.list(worktreeIdFor(root)).some((c) => c.consumer.sessionId === session),
  );
  if (registered === true) return null;
  if (registered !== false && registered.reason !== "no-store") return null;
  return (
    `OpenCode: no Squeal consumer is registered for this session in this worktree (OPENCODE_SESSION_ID ${session}). ` +
    "The Squeal OpenCode plugin ran in it but has not registered the session here yet: " +
    "it registers at the session's next message, also when it started before the store existed, " +
    "and a session may be registered in another worktree of the repository. " +
    `If the plugin is not installed, install it with ${INSTALL_SH_COMMAND}, then start OpenCode again.\n`
  );
}
