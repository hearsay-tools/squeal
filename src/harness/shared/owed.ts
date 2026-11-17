import { formatRegistration, MESSAGE_CAP_CHARS } from "../../core/delivery/format.js";
import { type OwedRegistration, owedRegistration } from "../../core/delivery/registration-owed.js";
import type { RegisterOptions } from "../../core/types/delivery.js";
import type { HookContext } from "./context.js";
import { coverageOf } from "./coverage.js";
import type { HookDeps } from "./hook.js";
import { withPrimer } from "./primer.js";

/*
 * Row 005-98 (the coordinator's decision C): a hook that registers owes the
 * session the registration's text until its output is written
 * (`core/delivery/registration-owed.ts`). It registers with `registerOwing`
 * and calls `context.delivery.registrationSent` as its last step; a tool
 * boundary or a prompt that finds the text still owed says it with
 * `sayOwed`, in place of its delta.
 */

/** Registers `context`'s consumer owing `owed`, and returns the registration's text. */
export async function registerOwing(
  context: HookContext,
  deps: HookDeps,
  owed: OwedRegistration,
  options: Omit<RegisterOptions, "owesText"> = {},
): Promise<string> {
  const registration = await context.delivery.register(context.consumer, {
    ...options,
    owesText: owed,
  });
  return owed.primer
    ? withPrimer(registration, deps.command, coverageOf(context))
    : formatRegistration(registration, MESSAGE_CAP_CHARS, deps.command);
}

/**
 * For a registered consumer whose registration text was never handed over (its hook was
 * killed after the registration, before its output): registers it again in the turn, owing
 * the same text, and returns that text; `null` when nothing is owed. The caller hands it
 * over with `registrationSent` as its last step.
 */
export async function sayOwed(
  context: HookContext,
  deps: HookDeps,
  options: Omit<RegisterOptions, "owesText">,
): Promise<string | null> {
  const owed = owedRegistration(context.store, context.consumer);
  return owed === null ? null : registerOwing(context, deps, owed, options);
}
