import type { EpochMs } from "../../core/types/common.js";
import { type HookContext, locate, usesSqueal } from "../shared/context.js";
import { deliver } from "../shared/deliver.js";
import { ensure, registerFirst } from "../shared/ensure.js";
import { type HookDeps, isRegistered, withContext } from "../shared/hook.js";
import { registerOwing } from "../shared/owed.js";
import { endSession, registerThenEnsure } from "../shared/session.js";
import { unregisterSession } from "../shared/sweep.js";
import type { PiSession, StartReason } from "./protocol.js";

/*
 * The worker's side of spec 009 D2 and D3 on the shared hook code (D6). A
 * consumer is `(session id, "main")`: Pi has no subagent inside one process.
 */

/** Reasons after which no earlier run of the session id goes on (D2, as 001's). */
const SWEEP_REASONS: ReadonlySet<StartReason> = new Set(["startup", "resume"]);

const consumerInput = (session: PiSession) => ({ session_id: session.sessionId });

/**
 * Row 005-98: what a Pi registration owes until the host has its answer: the header alone,
 * since the primer goes in the system prompt of every run (D3 `before_agent_start`).
 */
export const PI_OWED = { primer: false } as const;

/**
 * `session_start`: ensure the daemon, register, and return the registration
 * header to queue, or `null`. A repository that does not use Squeal gets
 * nothing, not even a daemon; without a usable store the daemon is still
 * ensured and the first tool boundary registers. `startup` and `resume`
 * unregister every other consumer of the session first; `new` and `fork`
 * carry a new session id, so a new consumer. `reload` re-runs the extension
 * in the same session: a consumer still registered keeps its view and hears
 * nothing, one that is not registers. The primer is not here: it goes in the
 * system prompt (D3 `before_agent_start`).
 */
export async function startSession(
  session: PiSession & { readonly reason: StartReason },
  deps: HookDeps,
): Promise<string | null> {
  const location = locate(session.cwd);
  if (location === null || !usesSqueal(location)) return null;
  let ensured = false;
  const text = await withContext(consumerInput(session), location, deps, async (context) => {
    ensured = true;
    // Row 005-98: the registration first, then the daemon's start, inside the event's deadline.
    const first = await registerFirst(location, deps, context);
    const text = await registerThenEnsure(first, () =>
      registerAtStart(session, context, deps, first.startingSince),
    );
    // Last: the text is handed over once the host has the answer (decision C).
    if (text !== null) await context.delivery.registrationSent(context.consumer);
    return text;
  });
  if (!ensured) await ensure(location, deps);
  return text;
}

/** `startSession`'s registration of `context`'s consumer, and the text it says; `null` for none. */
async function registerAtStart(
  session: PiSession & { readonly reason: StartReason },
  context: HookContext,
  deps: HookDeps,
  startingSince: EpochMs | undefined,
): Promise<string | null> {
  const reload = session.reason === "reload";
  if (reload && isRegistered(context)) return null;
  if (SWEEP_REASONS.has(session.reason)) {
    await unregisterSession(context, session.sessionId, {
      removeLocks: false,
      except: context.consumer,
    });
  }
  // After a reload the run may go on: its earlier tool calls may be in the registration revision.
  // Row 005-98: it owes its header, with no primer: Pi's primer is in each run's system prompt.
  return registerOwing(context, deps, PI_OWED, {
    atStart: !reload,
    ...(startingSince === undefined ? {} : { startingSince }),
  });
}

/** `session_shutdown`: unregister every consumer of the session, as 001's SessionEnd. */
export async function shutdownSession(session: PiSession, deps: HookDeps): Promise<null> {
  const location = locate(session.cwd);
  if (location !== null) await endSession(consumerInput(session), [location], deps);
  return null;
}

/**
 * A tool boundary: the consumer's delta as text, registering one that is not
 * (shared `deliver`); `edited` when a call of the batch may have changed files.
 */
export async function toolBoundary(
  session: PiSession,
  deps: HookDeps,
  edited = true,
): Promise<string | null> {
  const location = locate(session.cwd);
  if (location === null) return null;
  return withContext(consumerInput(session), location, deps, (context) =>
    deliver(context, deps, edited),
  );
}
