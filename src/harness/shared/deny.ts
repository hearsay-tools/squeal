import { readPolicy } from "../../core/daemon/policy.js";
import { formatDelta } from "../../core/delivery/index.js";
import { resumeTurn } from "../../core/delivery/turn.js";
import { REGRESSION_KINDS } from "../../core/types/index.js";
import type { HookContext } from "./context.js";
import { denialSentence } from "./text.js";

/**
 * Before a tool call (D9 PreToolUse, task 001-93): any call puts a consumer
 * left idle in a turn before it runs, so the waiter stays silent while another
 * Stop hook's continuation works. On an edit, with `interrupt.onRegression`
 * on, an undelivered regression denies the call once: the result is the
 * denial reason, `null` to let the call run. The peek marks only regressions
 * delivered, so recoveries stay for the next tool boundary and the same
 * regression never denies twice; it also puts the consumer in a turn.
 */
export async function denyOnRegression(
  context: HookContext,
  call: { readonly edit: boolean; readonly toolName: string },
): Promise<string | null> {
  if (!call.edit || !readPolicy(context.root).interrupt.onRegression) {
    resumeTurn(context.store, context.consumer);
    return null;
  }
  const delta = await context.delivery.peek(context.consumer, { kinds: REGRESSION_KINDS });
  if (delta === null) return null;
  return `${formatDelta(delta)}\n\n${denialSentence(call.toolName)}`;
}
