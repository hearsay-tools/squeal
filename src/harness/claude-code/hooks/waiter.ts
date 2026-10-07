import type { HookDeps } from "../../shared/hook.js";
import { waitIdle } from "../../shared/waiter.js";
import type { Handler } from "../hook.js";

/**
 * The waiter's `asyncRewake` hook timeout in hooks.json, seconds. Spec 001
 * D9: "Its `timeout` is explicit and long; expiry is silent and the next Stop
 * re-arms it." UserPromptSubmit re-arms it too (task 001-47).
 */
export const WAITER_HOOK_TIMEOUT_S = 3_600;

/** The waiter gives up a minute before Claude Code would kill it, so expiry is its own. */
export const WAITER_TIMEOUT_MS = (WAITER_HOOK_TIMEOUT_S - 60) * 1_000;

/**
 * Spec 001 D9 and research claude-code-integration §4: in `-p` mode
 * (`CLAUDE_CODE_ENTRYPOINT=sdk-cli`, `CLAUDE_CODE_SESSION_ATTENDED=0`)
 * `asyncRewake` blocks the agent, so the waiter never waits there. Both
 * variables are undocumented; anything but an attended non-SDK session counts
 * as non-interactive.
 */
export function isInteractive(env: HookDeps["env"]): boolean {
  return env.CLAUDE_CODE_SESSION_ATTENDED === "1" && env.CLAUDE_CODE_ENTRYPOINT !== "sdk-cli";
}

/**
 * The idle waiter (D9), as `waitIdle` says: a delta exits 2 with it on
 * stderr, which wakes an idle agent. `-p` mode exits 0 silently. Main agents
 * only: a subagent that stopped cannot be woken, and a wake would land in its
 * parent's context.
 */
export const waiter: Handler = async (input, location, deps) => {
  if (input.agent_id !== undefined || !isInteractive(deps.env)) return null;
  const text = await waitIdle(input, location, deps, deps.waiterTimeoutMs ?? WAITER_TIMEOUT_MS);
  return text === null ? null : { stderr: text, exitCode: 2 };
};
