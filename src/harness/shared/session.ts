import type { EpochMs } from "../../core/types/common.js";
import { type ConsumerInput, type HookContext, type HookLocation, usesSqueal } from "./context.js";
import { coverageOf } from "./coverage.js";
import { ensure } from "./ensure.js";
import { type HookDeps, isRegistered, withContext } from "./hook.js";
import { owedOf, registerAndHandOver, registerOwing, type Said } from "./owed.js";
import { primer } from "./primer.js";
import { unregisterSession } from "./sweep.js";

/** Sources after which no earlier run of the session id goes on. */
const SWEEP_SOURCES: ReadonlySet<string> = new Set(["startup", "resume"]);

/**
 * Session and subagent start (D9): ensure the daemon, register the consumer,
 * and return the registration to inject. A repository with neither a store
 * nor a `squeal.config.json` does not use Squeal and gets nothing, not even a
 * daemon. Without a usable store the daemon is still ensured, and the first
 * tool boundary registers. Row 005-98 (option A): the consumer registers
 * first and the daemon is ensured after, with no wait for a new daemon's
 * heartbeat, so a hook killed at its 2 s timeout while a daemon starts has
 * registered (`registerFirst`); the registration says a daemon is starting
 * when the store holds no fresh heartbeat (task 001-156). Row 005-102: a
 * registration that throws still ensures the daemon (`registerAndHandOver`).
 *
 * Lessons, defect 5: a session start (not a subagent's) with source `startup`
 * or `resume` means any earlier run of that session id is gone, so every
 * consumer of the session id still registered (a missed SessionEnd, subagents
 * of the earlier run, other worktrees) is unregistered before the main agent
 * registers. Review wave 4.5, S4: after `compact` the same run goes on, with
 * its subagents possibly running, so it keeps every consumer; a main agent
 * still registered keeps its view too, so nothing it was not told yet is
 * seeded away, and the hook says only the primer. `clear` and a missing source
 * do not sweep either.
 *
 * Task 001-88: wherever Squeal is used, the registration is followed by the
 * primer, and a main agent still registered after `compact` hears the primer
 * alone, since compaction drops it from context. Row 005-91 (d): a `resume`
 * keeps the earlier run's context, primer included, so it hears the
 * registration alone; Squawk resumes a session at each human turn. Without a usable store
 * nothing validates yet, so there is no primer either: the first
 * registration, here or on a prompt or a tool boundary, carries it.
 */
export async function startSession(
  input: ConsumerInput & { readonly source?: string },
  location: HookLocation,
  deps: HookDeps,
): Promise<string | null> {
  if (!usesSqueal(location)) return null;
  let ensured = false;
  const text = await withContext(input, location, deps, async (context) => {
    // The store is open already: its daemon record spares the probe a second open (S8).
    ensured = true;
    // Row 005-98: the registration first, then the daemon's start, then the hand-over.
    return registerAndHandOver(context, location, deps, {
      say: (startingSince) => registerAtStart(input, context, deps, startingSince),
    });
  });
  if (!ensured) await ensure(location, deps);
  return text;
}

/**
 * `startSession`'s registration of `context`'s consumer, and the text it says; `owes` when the
 * registration owes that text until the hook's output is written (`registerOwing`).
 */
async function registerAtStart(
  input: ConsumerInput & { readonly source?: string },
  context: HookContext,
  deps: HookDeps,
  startingSince: EpochMs | undefined,
): Promise<Said> {
  // Its own consumer is re-registered by `register` in one transaction, so a waiter of the
  // earlier run never sees it missing. Lock files stay: the waiter this SessionStart arms in
  // parallel reuses the main agent's (review wave 3, N3), and subagents have none.
  const main = input.agent_id === undefined;
  if (main && input.source === "compact" && isRegistered(context))
    return { text: primer(deps.command, coverageOf(context), { skill: deps.skill }), owes: false };
  if (main && input.source !== undefined && SWEEP_SOURCES.has(input.source)) {
    await unregisterSession(context, input.session_id, {
      removeLocks: false,
      except: context.consumer,
    });
  }
  // Row 005-91 (d): a resumed session's context still holds the primer its first run heard.
  const owed = owedOf(deps, main && input.source === "resume");
  // After `compact` the run goes on: its earlier tool calls may be in the registration revision.
  const text = await registerOwing(context, deps, owed, {
    atStart: input.source !== "compact",
    ...(startingSince === undefined ? {} : { startingSince }),
  });
  return { text, owes: true };
}

/**
 * Session end (D9): unregister the session's consumers, the main agent and
 * every subagent, in the store of each of `locations`, and remove waiter lock
 * files no waiter holds. A session end carries no agent id, and a subagent
 * ends with its session.
 *
 * Lessons, defect 5: one `/exit` left its consumer registered. So this
 * ignores the end reason (every reason ends the session), never consults or
 * starts the daemon, and looks the session up in every worktree of each
 * store. A session end that still misses is caught by the next session start
 * of the same session id, or by daemon-side expiry (D10).
 */
export async function endSession(
  input: ConsumerInput,
  locations: readonly HookLocation[],
  deps: HookDeps,
): Promise<void> {
  for (const at of locations) {
    await withContext(input, at, deps, async (context) => {
      await unregisterSession(context, input.session_id, { removeLocks: true });
      return null;
    });
  }
}
