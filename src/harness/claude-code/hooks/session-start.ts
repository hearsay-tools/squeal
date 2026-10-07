import { formatRegistration, MESSAGE_CAP_CHARS } from "../../../core/delivery/index.js";
import { usesSqueal } from "../context.js";
import { ensure, settle } from "../ensure.js";
import { isFork } from "../fork.js";
import { additionalContext, type Handler, isRegistered, withContext } from "../hook.js";
import { unregisterSession } from "../sweep.js";

/**
 * SessionStart and SubagentStart (D9): ensure the daemon, register the
 * consumer, inject the registration. A repository with neither a store nor a
 * `squeal.config.json` does not use Squeal and gets nothing, not even a daemon.
 * Without a usable store the daemon is still ensured, and the first
 * PostToolBatch registers. After spawning a daemon, registration waits
 * briefly for its heartbeat, so its header reports a daemon that is about to
 * validate as validating.
 *
 * Lessons, defect 5: a SessionStart (not SubagentStart) with source `startup`
 * or `resume` means any earlier run of that session id is gone, so every
 * consumer of the session id still registered (a missed SessionEnd, subagents
 * of the earlier run, other worktrees) is unregistered before the main agent
 * registers. Review wave 4.5, S4: after `compact` the same run goes on, with
 * its subagents possibly running, so it keeps every consumer; a main agent
 * still registered keeps its view too, so nothing it was not told yet is
 * seeded away, and the hook says only the primer. `clear` and a missing source
 * do not sweep either.
 *
 * Lessons, defect 9: the SubagentStart of one of Claude Code's internal forks
 * does nothing, since a fork is not a consumer.
 *
 * Task 001-88: wherever Squeal is used, the registration is followed by the
 * primer, and a main agent still registered after `compact` hears the primer
 * alone, since compaction drops it from context. A repository with a config
 * but no store yet gets the primer alone.
 */
/** Sources after which no earlier run of the session id goes on. */
const SWEEP_SOURCES: ReadonlySet<string> = new Set(["startup", "resume"]);

/**
 * How to work with Squeal, decided by the human (task 001-88). The one
 * prohibition D6's factual wording allows, paired with what to do instead.
 */
export const PRIMER = [
  "Squeal runs this repository's Vitest tests in the background after each edit, and its results arrive as SQUEAL messages after your tool calls; do not run Vitest to learn whether your edits broke something.",
  "Results arrive with your next tool call, so keep working; wait only when you need a result before your next step, for example before saying the task is done: `squeal status --wait 60000`.",
  "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
  "Squeal does not cover typecheck, build or other test suites.",
].join(" ");

/** Room the registration leaves for the primer within the message cap. */
const REGISTRATION_MAX = MESSAGE_CAP_CHARS - PRIMER.length - 2;

export const sessionStart: Handler = async (input, location, deps) => {
  if (isFork(input) || !usesSqueal(location)) return null;
  let ensured = false;
  const outcome = await withContext(input, location, deps, async (context) => {
    // The store is open already: its daemon record spares the probe a second open (S8).
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    ensured = true;
    if ((await ensure(location, deps, record)) === "spawned") await settle(context, deps);
    // Its own consumer is re-registered by `register` in one transaction, so a waiter of the
    // earlier run never sees it missing. Lock files stay: the waiter this SessionStart arms in
    // parallel reuses the main agent's (review wave 3, N3), and subagents have none.
    const main = input.agent_id === undefined;
    if (main && input.source === "compact" && isRegistered(context)) {
      return additionalContext(input, PRIMER);
    }
    if (main && input.source !== undefined && SWEEP_SOURCES.has(input.source)) {
      await unregisterSession(context, input.session_id, {
        removeLocks: false,
        except: context.consumer,
      });
    }
    const registration = await context.delivery.register(context.consumer);
    return additionalContext(
      input,
      `${formatRegistration(registration, REGISTRATION_MAX)}\n\n${PRIMER}`,
    );
  });
  if (!ensured) await ensure(location, deps);
  return outcome ?? additionalContext(input, PRIMER);
};
