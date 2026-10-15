import type { HookDeps } from "../shared/hook.js";
import { forgetRoot, sessionLocation } from "../shared/session-root.js";
import type { CodexHandler } from "./hook.js";
import { isUnservedThread, parseCodexInput } from "./input.js";

/** What one Codex hook process writes. It always exits 0. */
export interface CodexHookResult {
  readonly stdout: string;
  readonly stderr: string;
}

const SILENT: CodexHookResult = { stdout: "", stderr: "" };

/**
 * Runs one Codex hook on its stdin text. Spec 002 D3: "Every script exits 0
 * with no output on any internal error." The root is the one the thread's
 * SessionStart resolved from its stdin `cwd`, the thread's working
 * directory in every mode (`research/wave-0-checks.md` 2; task 001-405,
 * `sessionLocation`), and a subagent's the one its SubagentStart resolved
 * until its SubagentStop (task 001-415);
 * no Codex hook reads a `CLAUDE_*` variable, which Codex passes through from
 * whatever launched it (D4). Malformed input, a cwd outside any git worktree,
 * a missing or unreadable store and every thrown error end silent, and so
 * does a thread that is not a consumer (`isUnservedThread`, D2), before any
 * handler locates or opens a store.
 * `SQUEAL_HOOK_DEBUG=1` reports the swallowed error on stderr, which Codex
 * does not show the model after exit 0.
 */
export async function runCodexHandler(
  name: string,
  handler: CodexHandler,
  stdin: string,
  deps: HookDeps,
): Promise<CodexHookResult> {
  try {
    const input = parseCodexInput(stdin);
    if (input === null || isUnservedThread(input)) return SILENT;
    const start = name === "session-start" || name === "subagent-start";
    const location = sessionLocation(input, start, deps.sessionRoots);
    if (location === null) return SILENT;
    if (name === "session-end" || name === "subagent-stop") forgetRoot(input, deps.sessionRoots);
    const output = await handler(input, location, deps);
    return output === null ? SILENT : { stdout: JSON.stringify(output), stderr: "" };
  } catch (error) {
    if (deps.env.SQUEAL_HOOK_DEBUG === "1") {
      return { ...SILENT, stderr: `squeal codex ${name} hook: ${String(error)}\n` };
    }
    return SILENT;
  }
}
