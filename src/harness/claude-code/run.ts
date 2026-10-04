import { locate } from "./context.js";
import type { Handler, HookDeps } from "./hook.js";
import { parseHookInput } from "./input.js";

export interface HookResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: 0 | 2;
}

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };

/**
 * Runs one hook on its stdin text. Spec 001 D9: every hook "exits 0 with no
 * output on any internal error". Malformed input, a cwd outside any git
 * worktree, a missing or unreadable store and every thrown error end silent.
 * `SQUEAL_HOOK_DEBUG=1` reports the swallowed error on stderr, which Claude
 * Code does not show the model after exit 0.
 */
export async function runHandler(
  name: string,
  handler: Handler,
  stdin: string,
  deps: HookDeps,
): Promise<HookResult> {
  try {
    const input = parseHookInput(stdin);
    if (input === null) return SILENT;
    const location = locate(input.cwd);
    if (location === null) return SILENT;
    const outcome = await handler(input, location, deps);
    if (outcome === null) return SILENT;
    return {
      stdout: outcome.output === undefined ? "" : JSON.stringify(outcome.output),
      stderr: outcome.stderr ?? "",
      exitCode: outcome.exitCode ?? 0,
    };
  } catch (error) {
    if (deps.env.SQUEAL_HOOK_DEBUG === "1") {
      return { ...SILENT, stderr: `squeal ${name} hook: ${String(error)}\n` };
    }
    return SILENT;
  }
}
