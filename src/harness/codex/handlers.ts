import { readPolicy } from "../../core/daemon/policy.js";
import { usesSqueal } from "../shared/context.js";
import { deliver } from "../shared/deliver.js";
import { denyCurrentTestCommand, denyOnRegression, testCommandOf } from "../shared/deny.js";
import { isRegistered, withContext } from "../shared/hook.js";
import { submitPrompt } from "../shared/prompt.js";
import { endSession, startSession } from "../shared/session.js";
import { stopTurn } from "../shared/stop.js";
import { stopSlow } from "../shared/stop-slow.js";
import type { CodexHandler } from "./hook.js";
import type { CodexHookInput } from "./input.js";
import { keepCodexVersion, skillLine } from "./kept.js";
import { additionalContext, block, deny } from "./output.js";

/*
 * The Codex hooks of spec 002 D3 on the shared hook code (D5). A consumer is
 * `(session_id, agent_id ?? "main")` from stdin (D2).
 */

/**
 * D2: `clear` acts as `startup` and `resume` (sweep the session's other
 * consumers, register, inject); `fork` mints a thread id and is a new
 * consumer; `compact` keeps the view and says only the primer.
 */
function sessionSource(input: CodexHookInput): { source?: string } {
  const source = input.source === "clear" ? "startup" : input.source;
  return source === undefined ? {} : { source };
}

/**
 * SessionStart: keep this version's copy (spec 005 D3 as amended 2026-10-21)
 * in a repository that uses Squeal, so the daemon it ensures runs from the
 * copy; register, inject the header, the copy's skill line and the primer.
 */
export const sessionStart: CodexHandler = async (input, location, deps) => {
  const kept = usesSqueal(location) ? keepCodexVersion(deps) : deps;
  const text = await startSession({ ...input, ...sessionSource(input) }, location, kept);
  return text === null
    ? null
    : additionalContext("SessionStart", text, kept.command, skillLine(kept));
};

/**
 * UserPromptSubmit, also for `turn/steer` and queued input: `startTurn`, the
 * undelivered delta on the prompt. Every Codex consumer has no waiter, so the
 * daemon may expire one left idle (001 D10); the prompt then registers it
 * again, and the header restates the current failures.
 */
export const userPromptSubmit: CodexHandler = async (input, location, deps) => {
  const text = await submitPrompt(input, location, deps, { register: true });
  return text === null ? null : additionalContext("UserPromptSubmit", text, deps.command);
};

/**
 * PreToolUse, matcher `*`: an idle consumer is put back in a turn; an
 * `apply_patch` (Codex's `tool_name` for `Edit` and `Write` too) after an
 * undelivered regression is denied once, with `interrupt.onRegression` on.
 * `Bash` is never denied by default: the watcher stays the source of truth.
 * With `testCommand.denyWhenCurrent` on, spec 005 D8 denies a test command
 * Squeal has answered once (`denyCurrentTestCommand`), after the regression
 * deny, one reason per call; the policy is read and the command recognized
 * before the store opens.
 */
export const preToolUse: CodexHandler = (input, location, deps) => {
  const policy = readPolicy(location.root);
  const testCommand = testCommandOf(location, policy, {
    toolName: input.tool_name ?? "",
    cwd: input.cwd,
    ...(input.command === undefined ? {} : { command: input.command }),
  });
  return withContext(input, location, deps, async (context) => {
    const reason =
      (await denyOnRegression(context, policy, {
        edit: input.tool_name === "apply_patch",
        toolName: input.tool_name ?? "tool",
        command: deps.command,
      })) ??
      (testCommand === null
        ? null
        : denyCurrentTestCommand(context, testCommand, policy.nodeTest, (deps.now ?? Date.now)()));
    return reason === null ? null : deny(reason, deps.command);
  });
};

/**
 * PostToolUse, matcher `*`, the primary push: once per nested tool call, so
 * the delivery view keeps it idempotent; the second call of a batch finds
 * nothing undelivered.
 */
export const postToolUse: CodexHandler = (input, location, deps) =>
  withContext(input, location, deps, async (context) => {
    const text = await deliver(context, deps);
    return text === null ? null : additionalContext("PostToolUse", text, deps.command);
  });

/**
 * Stop speaks only with news, as a `block` whose reason is the report: Stop
 * has no `additionalContext`, so news always costs a continuation and silence
 * costs nothing. With `stop_hook_active` it never blocks again, whatever
 * landed since: it ends the turn and leaves the delta undelivered for the next
 * prompt or tool call.
 */
export const stop: CodexHandler = async (input, location, deps) => {
  if (input.stop_hook_active === true) {
    return withContext(input, location, deps, async (context) => {
      await context.delivery.endTurn(context.consumer);
      return null;
    });
  }
  const outcome = await stopTurn(
    { ...input, stopHookActive: false, harness: "codex" },
    location,
    deps,
  );
  if (outcome === null) return null;
  return block("block" in outcome ? outcome.block : outcome.news, deps.command);
};

/**
 * The waiting Stop entry beside `stop` (spec 004 D9 as amended 2026-10-12):
 * with `stop.requireSlowSuite` on, waits for the slow tier as `stopSlow` says
 * and blocks with its reason; silent otherwise.
 */
export const stopSlowTier: CodexHandler = async (input, location, deps) => {
  const reason = await stopSlow(
    { ...input, stopHookActive: input.stop_hook_active === true, harness: "codex" },
    location,
    deps,
  );
  return reason === null ? null : block(reason, deps.command);
};

/**
 * SubagentStart: register `(session_id, agent_id)` and inject the header and
 * the primer, which Codex puts in the subagent's first request (D3 as amended,
 * review wave 1, S2). Without them a subagent's first boundary finds it
 * registered and says only a delta, so it never hears the primer.
 */
export const subagentStart: CodexHandler = async (input, location, deps) => {
  if (input.agent_id === undefined) return null;
  const text = await startSession(
    { session_id: input.session_id, agent_id: input.agent_id },
    location,
    deps,
  );
  return text === null
    ? null
    : additionalContext("SubagentStart", text, deps.command, skillLine(deps));
};

/** SubagentStop: unregister `(session_id, agent_id)`; the parent's view is untouched. */
export const subagentStop: CodexHandler = (input, location, deps) =>
  input.agent_id === undefined
    ? Promise.resolve(null)
    : withContext(input, location, deps, async (context) => {
        if (isRegistered(context)) await context.delivery.unregister(context.consumer);
        return null;
      });

/**
 * Interrupt: `endTurn`, since no Stop follows an interrupt and no PostToolUse
 * follows the interrupted call. One store write, within its 1 to 3 s clamp.
 */
export const interrupt: CodexHandler = (input, location, deps) =>
  withContext(input, location, deps, async (context) => {
    await context.delivery.endTurn(context.consumer);
    return null;
  });

/**
 * SessionEnd: unregister the session's consumers, main agent and subagents,
 * in the store of `cwd` only (review wave 1, N3). The Claude Code adapter adds
 * the store of its project directory; Codex gives SessionEnd only the current
 * `cwd`, a Claude Code variable here would be a launcher's (D4), and the rollout
 * at `transcript_path` has no verified format. A consumer left in a repository
 * the thread left by a `turn/start` `cwd` is caught by the next `startup` or
 * `resume` SessionStart of the session there, or by daemon expiry (001 D10).
 */
export const sessionEnd: CodexHandler = async (input, location, deps) => {
  await endSession(input, [location], deps);
  return null;
};
