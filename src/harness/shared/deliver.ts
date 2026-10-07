import { formatDelta, notValidatedLine, worktreeLiveness } from "../../core/delivery/index.js";
import type { HookContext } from "./context.js";
import { ensureIfStale } from "./ensure.js";
import { type HookDeps, isRegistered } from "./hook.js";
import { withPrimer } from "./primer.js";

/**
 * Tools that change files in the worktree: Claude Code's edit tools, Codex's
 * `apply_patch` (its `Edit` and `Write` too), and a shell in either.
 */
const EDITING_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "apply_patch",
]);

/**
 * Whether tool calls named `toolNames` may have changed files; with no names
 * the harness did not say, which counts as an edit (task 001-112).
 */
export function mayEdit(toolNames: readonly string[] | undefined): boolean {
  return toolNames === undefined || toolNames.some((name) => EDITING_TOOLS.has(name));
}

/**
 * The deliver step of a tool boundary (D9 PostToolBatch, 002 D5 PostToolUse),
 * the primary push channel: the consumer's delta as text, or `null`. A
 * consumer without a registration (the store did not exist yet at
 * SessionStart, or the registration expired) is registered here instead, so
 * it never waits silently for a SessionStart that will not come again. A
 * heartbeat older than two intervals restarts the daemon (review wave 3,
 * S2); the delta then says no daemon is validating, once. When none could be
 * started (one holds the lock and does not answer, lessons defect 22), a
 * boundary that `edited` adds one line saying the edit has no result, every
 * time, so silence never reads as no failures (task 001-112).
 */
export async function deliver(
  context: HookContext,
  deps: HookDeps,
  edited = true,
): Promise<string | null> {
  const ensured = await ensureIfStale(context, deps);
  if (!isRegistered(context)) {
    const registration = await context.delivery.register(context.consumer, { inTurn: true });
    return withPrimer(registration);
  }
  const delta = await context.delivery.onToolBoundary(context.consumer);
  const text = delta === null ? null : formatDelta(delta);
  const line = edited && ensured === "unavailable" ? notValidated(context, deps) : null;
  if (line === null) return text;
  return text === null ? `SQUEAL · ${line}` : `${text}\n${line}`;
}

/** The "Not validated" line while the heartbeat is past grace; `null` once it is fresh again. */
function notValidated(context: HookContext, deps: HookDeps): string | null {
  const record = context.store.worktrees.get(context.consumer.worktreeId);
  const live = worktreeLiveness(record, (deps.now ?? Date.now)());
  return live.state === "down" ? notValidatedLine(live) : null;
}
