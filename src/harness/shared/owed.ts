import { formatRegistration, MESSAGE_CAP_CHARS } from "../../core/delivery/format.js";
import { type OwedRegistration, owedRegistration } from "../../core/delivery/registration-owed.js";
import { daemonLiveness } from "../../core/presence/heartbeat.js";
import type { EpochMs } from "../../core/types/common.js";
import type { RegisterOptions } from "../../core/types/delivery.js";
import type { HookContext, HookLocation } from "./context.js";
import { coverageOf } from "./coverage.js";
import { registerFirst, type StartFirst } from "./ensure.js";
import type { HookDeps } from "./hook.js";
import { withPrimer } from "./primer.js";

/*
 * Row 005-98 (the coordinator's decision C): a hook that registers owes the
 * session the registration's text until its output is written
 * (`core/delivery/registration-owed.ts`). It registers with `registerOwing`
 * and calls `context.delivery.registrationSent` as its last step; a tool
 * boundary or a prompt that finds the text still owed says it with
 * `sayOwed`, in place of its delta. Row 005-117: one sequence for every
 * harness, `registerAndHandOver`, and the primer decided once per harness
 * (`HookDeps.registrationPrimer`).
 */

/** Registration options a caller chooses: the owed text and the start are the helpers'. */
export type HandOverOptions = Omit<RegisterOptions, "owesText" | "startingSince">;

/** What a registration said, and whether its consumer is owed that text until it is handed over. */
export interface Said {
  readonly text: string;
  readonly owes: boolean;
}

/** How one entry registers once the start is read: what it said, or `null` for nothing. */
export type SayRegistration = (startingSince: EpochMs | undefined) => Promise<Said | null>;

/**
 * What a new registration of `deps`'s harness owes: the primer with the header, unless the
 * harness puts the primer in its system prompt (Pi, OpenCode), or `resumed`: the session's
 * context still holds the primer its first run heard (row 005-91 (d)).
 */
export function owedOf(deps: HookDeps, resumed = false): OwedRegistration {
  return { primer: deps.registrationPrimer !== false && !resumed };
}

/** Registers `context`'s consumer owing `owed`, and returns the registration's text. */
export async function registerOwing(
  context: HookContext,
  deps: HookDeps,
  owed: OwedRegistration,
  options: Omit<RegisterOptions, "owesText">,
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
 * Registers `context`'s consumer as a new registration of `deps`'s harness (`owedOf`), owing its
 * text, and hands that text over (`registrationSent`) as the last step; returns the text.
 */
export async function registerSaying(
  context: HookContext,
  deps: HookDeps,
  options: Omit<RegisterOptions, "owesText">,
): Promise<string> {
  const text = await registerOwing(context, deps, owedOf(deps), options);
  await context.delivery.registrationSent(context.consumer);
  return text;
}

/**
 * For a registered consumer whose registration text was never handed over (its hook was
 * killed after the registration, before its output): registers it again in the turn, owing
 * the same text, hands that text over as the last step and returns it; `null` when nothing is
 * owed.
 */
export async function sayOwed(
  context: HookContext,
  deps: HookDeps,
  options: Omit<RegisterOptions, "owesText">,
): Promise<string | null> {
  const owed = owedRegistration(context.store, context.consumer);
  if (owed === null) return null;
  const text = await registerOwing(context, deps, owed, options);
  await context.delivery.registrationSent(context.consumer);
  return text;
}

/**
 * Row 005-98: the registration first, then the daemon's start, inside the hook's timeout, then
 * the text handed over last (decision C), for every harness. `options.say` registers (default: a
 * new registration of `deps`'s harness, owing its text, with `options.register`);
 * `options.whenDown` starts a daemon only when none is alive (a prompt, a run start). Returns
 * the text said, or `null`.
 */
export async function registerAndHandOver(
  context: HookContext,
  location: HookLocation,
  deps: HookDeps,
  options: {
    readonly whenDown?: boolean;
    readonly register?: HandOverOptions;
    readonly say?: SayRegistration;
  },
): Promise<string | null> {
  const now = (deps.now ?? Date.now)();
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  const alive = options.whenDown === true && daemonLiveness(record, now).state === "alive";
  const first = alive ? null : await registerFirst(location, deps, context);
  const say =
    options.say ??
    (async (startingSince) => ({
      text: await registerOwing(context, deps, owedOf(deps), {
        ...options.register,
        ...(startingSince === undefined ? {} : { startingSince }),
      }),
      owes: true,
    }));
  const said = await registerThenEnsure(first, () => say(first?.startingSince));
  if (said === null) return null;
  // Last: the text is handed over once the hook's output is written (decision C).
  if (said.owes) await context.delivery.registrationSent(context.consumer);
  return said.text;
}

/**
 * Row 005-102: `register`, then the daemon's start `first.ensure()`, also when `register` throws
 * (a busy store, any error), as before 0.1.541, when the start came first; else the daemon would
 * start only at the first tool boundary. The registration's error is the one thrown, and an
 * ensure that fails after it is not said. `first` `null`: nothing to start (a daemon is alive).
 */
async function registerThenEnsure<T>(
  first: StartFirst | null,
  register: () => Promise<T>,
): Promise<T> {
  let registered: T;
  try {
    registered = await register();
  } catch (error) {
    await first?.ensure().catch(() => undefined);
    throw error;
  }
  await first?.ensure();
  return registered;
}
