import { formatRegistration, MESSAGE_CAP_CHARS } from "../../core/delivery/index.js";
import { locate, usesSqueal } from "../shared/context.js";
import { deliver } from "../shared/deliver.js";
import { ensure, ensureToRegister } from "../shared/ensure.js";
import { type HookDeps, isRegistered, withContext } from "../shared/hook.js";
import { endSession } from "../shared/session.js";
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
    const startingSince = await ensureToRegister(location, deps, context);
    const reload = session.reason === "reload";
    if (reload && isRegistered(context)) return null;
    if (SWEEP_REASONS.has(session.reason)) {
      await unregisterSession(context, session.sessionId, {
        removeLocks: false,
        except: context.consumer,
      });
    }
    // After a reload the run may go on: its earlier tool calls may be in the registration revision.
    const registration = await context.delivery.register(context.consumer, {
      atStart: !reload,
      ...(startingSince === undefined ? {} : { startingSince }),
    });
    return formatRegistration(registration, MESSAGE_CAP_CHARS, deps.command);
  });
  if (!ensured) await ensure(location, deps);
  return text;
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
