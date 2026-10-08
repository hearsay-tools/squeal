import { readPolicy } from "../../core/daemon/policy.js";
import { formatDelta } from "../../core/delivery/index.js";
import { resumeTurn } from "../../core/delivery/turn.js";
import type { DeltaKind } from "../../core/types/index.js";
import type { HookContext } from "./context.js";
import { denialSentence } from "./text.js";

/**
 * The regressions an edit is denied for (task 001-101, lessons defect 17): a
 * check this worktree knew passing, its own result or an inherited one, that
 * fails now, with only unknown results in between. A first-seen failure, the
 * baseline's included, is delivered at the tool boundary and never denies.
 */
const DENIED_KINDS: readonly DeltaKind[] = ["pass-to-fail"];

/**
 * Before a tool call (D9 PreToolUse, task 001-93): any call puts a consumer
 * left idle in a turn before it runs, so the waiter stays silent while another
 * Stop hook's continuation works. On an edit, with `interrupt.onRegression`
 * on, an undelivered `PASS -> FAIL` denies the call once: the result is the
 * denial reason, `null` to let the call run. The peek marks only those
 * entries delivered, so recoveries and first-seen failures stay for the next
 * tool boundary and the same regression never denies twice; it also puts the
 * consumer in a turn.
 */
export async function denyOnRegression(
  context: HookContext,
  call: {
    readonly edit: boolean;
    readonly toolName: string;
    readonly command?: string | undefined;
  },
): Promise<string | null> {
  if (!call.edit || !readPolicy(context.root).interrupt.onRegression) {
    resumeTurn(context.store, context.consumer);
    return null;
  }
  const delta = await context.delivery.peek(context.consumer, { kinds: DENIED_KINDS });
  if (delta === null) return null;
  return `${formatDelta(delta, call.command)}\n\n${denialSentence(call.toolName)}`;
}
