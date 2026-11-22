import type { HookDeps } from "../shared/hook.js";
import { sessionLocation } from "../shared/session-root.js";
import type { AntigravityHandler } from "./hook.js";
import { parseAntigravityInput } from "./input.js";

/** What one Antigravity hook process writes. It always exits 0. */
export interface AntigravityHookResult {
  readonly stdout: string;
  readonly stderr: string;
}

const SILENT: AntigravityHookResult = { stdout: "", stderr: "" };

/**
 * Runs one Antigravity hook on its stdin text (spec 024 D3, D4). The root is
 * the one the conversation's SessionStart resolved from its stdin `cwd`
 * (`sessionLocation`, keyed by `conversationId`, D2); a conversation with
 * none kept, as after a `--conversation` resume, keeps the first root a hook
 * resolves. Malformed input, a cwd outside any git worktree, a missing or
 * unreadable store and every thrown error end with empty stdout, never `{}`,
 * which PreToolUse reads as a deny. `SQUEAL_HOOK_DEBUG=1` reports the
 * swallowed error on stderr.
 */
export async function runAntigravityHandler(
  name: string,
  handler: AntigravityHandler,
  stdin: string,
  deps: HookDeps,
): Promise<AntigravityHookResult> {
  try {
    const input = parseAntigravityInput(stdin);
    if (input === null) return SILENT;
    const location = sessionLocation(
      { session_id: input.conversationId, cwd: input.cwd },
      name === "session-start",
      deps.sessionRoots,
    );
    if (location === null) return SILENT;
    const output = await handler(input, location, deps);
    return output === null ? SILENT : { stdout: JSON.stringify(output), stderr: "" };
  } catch (error) {
    // Row 011-288: a report its output no longer carries stays owed.
    deps.handOff?.abandon();
    if (deps.env.SQUEAL_HOOK_DEBUG === "1") {
      return { ...SILENT, stderr: `squeal antigravity ${name} hook: ${String(error)}\n` };
    }
    return SILENT;
  }
}
