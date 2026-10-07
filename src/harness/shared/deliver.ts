import { formatDelta } from "../../core/delivery/index.js";
import type { HookContext } from "./context.js";
import { ensureIfStale } from "./ensure.js";
import { type HookDeps, isRegistered } from "./hook.js";
import { withPrimer } from "./primer.js";

/**
 * The deliver step of a tool boundary (D9 PostToolBatch, 002 D5 PostToolUse),
 * the primary push channel: the consumer's delta as text, or `null`. A
 * consumer without a registration (the store did not exist yet at
 * SessionStart, or the registration expired) is registered here instead, so
 * it never waits silently for a SessionStart that will not come again. A
 * heartbeat older than two intervals restarts the daemon (review wave 3,
 * S2); the delta then says no daemon is validating, once.
 */
export async function deliver(context: HookContext, deps: HookDeps): Promise<string | null> {
  await ensureIfStale(context, deps);
  if (!isRegistered(context)) {
    const registration = await context.delivery.register(context.consumer, { inTurn: true });
    return withPrimer(registration);
  }
  const delta = await context.delivery.onToolBoundary(context.consumer);
  return delta === null ? null : formatDelta(delta);
}
