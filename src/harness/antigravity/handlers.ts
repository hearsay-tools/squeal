import { readPolicy } from "../../core/daemon/policy.js";
import { usesSqueal } from "../shared/context.js";
import { deliver } from "../shared/deliver.js";
import { denyCurrentTestCommand, denyOnRegression, testCommandOf } from "../shared/deny.js";
import { withContext } from "../shared/hook.js";
import { submitPrompt } from "../shared/prompt.js";
import { startSession } from "../shared/session.js";
import { stopTurn } from "../shared/stop.js";
import { stopSlow } from "../shared/stop-slow.js";
import type { AntigravityHandler } from "./hook.js";
import type { AntigravityHookInput } from "./input.js";
import { keepAntigravityVersion, registeredSkillLine, skillLine } from "./kept.js";
import { continueTurn, deny, injectSystemMessage } from "./output.js";

/*
 * The Antigravity hooks of spec 024 D3 on the shared hook code (D5). A
 * consumer is `(conversationId, "main")` (D2): a subagent has a conversation
 * of its own and runs every hook event for it, so it is a main agent too.
 */

const consumerOf = (input: AntigravityHookInput) => ({ session_id: input.conversationId });

/** The file writers of the CLI and of the App and IDE (D3): what `interrupt.onRegression` denies. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
]);

/**
 * D3's Stop guards: a turn an abort, an error or a limit ended
 * (`terminationReason` other than `NO_TOOL_CALL`), or one that paused while a
 * background subagent, command or timer runs (`fullyIdle: false`, the
 * human's 2026-11-22 choice). Neither speaks nor holds.
 */
function stopGuarded(input: AntigravityHookInput): boolean {
  const reason = input.terminationReason ?? "";
  return (reason !== "" && reason !== "NO_TOOL_CALL") || input.fullyIdle === false;
}

/**
 * SessionStart: keep this version's copy (D1) in a repository that uses
 * Squeal, so the daemon it ensures runs from the copy; register, inject the
 * header, the copy's skill line and the primer.
 */
export const sessionStart: AntigravityHandler = async (input, location, deps) => {
  const kept = usesSqueal(location) ? keepAntigravityVersion(deps) : deps;
  const text = await startSession({ ...consumerOf(input), source: "startup" }, location, kept);
  return text === null ? null : injectSystemMessage(text, kept.command, skillLine(kept));
};

/**
 * PreInvocation, before every model call. At `invocationNum` 0, a user
 * turn's start (also a `--conversation` resume, which fires no
 * SessionStart): `startTurn` with the undelivered delta, or a registration
 * of a consumer the store came after or the daemon expired. After a tool
 * batch (`invocationNum` > 0), the primary push: the delivery view keeps one
 * batch's parallel calls to one delivery. A registration names the kept
 * skill (`registeredSkillLine`).
 */
export const preInvocation: AntigravityHandler = async (input, location, deps) => {
  const text =
    (input.invocationNum ?? 0) === 0
      ? await submitPrompt(consumerOf(input), location, deps, { register: true })
      : await withContext(consumerOf(input), location, deps, (context) =>
          deliver(context, deps, true),
        );
  return text === null
    ? null
    : injectSystemMessage(text, deps.command, registeredSkillLine(text, deps));
};

/**
 * PreToolUse, matcher of the edit tools and `run_command`: an idle consumer
 * is put back in a turn; an edit after an undelivered regression is denied
 * once, with `interrupt.onRegression` on. `run_command` is never denied by
 * default; with `testCommand.denyWhenCurrent` on, spec 005 D8 denies a test
 * command Squeal has answered once, its `Cwd` or the workspace's, under the
 * shared recognizer's shell tool name, as Pi's `bash` is. Empty stdout
 * allows it.
 */
export const preToolUse: AntigravityHandler = (input, location, deps) => {
  const policy = readPolicy(location.root);
  const toolName = input.toolName ?? "";
  const testCommand =
    toolName === "run_command"
      ? testCommandOf(location, policy, {
          toolName: "Bash",
          cwd: input.toolCwd ?? input.cwd,
          ...(input.command === undefined ? {} : { command: input.command }),
        })
      : null;
  return withContext(consumerOf(input), location, deps, async (context) => {
    const reason =
      (await denyOnRegression(context, policy, {
        edit: EDIT_TOOLS.has(toolName),
        toolName: toolName === "" ? "tool" : toolName,
        command: deps.command,
      })) ??
      (testCommand === null
        ? null
        : await denyCurrentTestCommand(context, testCommand, (deps.now ?? Date.now)()));
    return reason === null ? null : deny(reason, deps.command);
  });
};

/**
 * Stop, the first of two sequential entries. A guarded turn (`stopGuarded`)
 * ends with no handoff, so `stop-slow` holds nothing. Otherwise `stopTurn`
 * speaks only with news or a policy block, as a `"continue"`, which skips
 * `stop-slow`. After a continuation (`executionNum` > 0, or
 * `continuationActive`) it runs `quiet`: no news, only a hold for the checks
 * Stop requires while the turn has holds left. Silent, it ends the turn and
 * hands the required checks to `stop-slow` (`stopRules` for `antigravity`).
 */
export const stop: AntigravityHandler = async (input, location, deps) => {
  if (stopGuarded(input)) {
    await withContext(consumerOf(input), location, deps, async (context) => {
      await context.delivery.endTurn(context.consumer);
      return null;
    });
    return null;
  }
  const active = input.continuationActive === true || (input.executionNum ?? 0) > 0;
  const outcome = await stopTurn(
    {
      ...consumerOf(input),
      stopHookActive: active,
      harness: "antigravity",
      ...(active ? { quiet: true } : {}),
    },
    location,
    deps,
  );
  if (outcome === null) return null;
  return continueTurn("block" in outcome ? outcome.block : outcome.news, deps.command);
};

/**
 * Stop, the second entry, which runs only after a silent `stop`: waits for
 * the checks Stop requires as `stopSlow` says, and continues the turn with
 * its reason; silent otherwise, and at once for a guarded turn.
 */
export const stopSlowTier: AntigravityHandler = async (input, location, deps) => {
  if (stopGuarded(input)) return null;
  const reason = await stopSlow({ ...consumerOf(input), harness: "antigravity" }, location, deps);
  return reason === null ? null : continueTurn(reason, deps.command);
};
