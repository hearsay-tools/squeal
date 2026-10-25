import { readPolicy } from "../../core/daemon/policy.js";
import { formatDelta, formatRegistration, MESSAGE_CAP_CHARS } from "../../core/delivery/index.js";
import { daemonLiveness } from "../../core/delivery/liveness.js";
import { locate, usesSqueal } from "../shared/context.js";
import { coverageOf } from "../shared/coverage.js";
import { denyCurrentTestCommand, denyOnRegression, testCommandOf } from "../shared/deny.js";
import { ensureToRegister } from "../shared/ensure.js";
import { type HookDeps, withContext } from "../shared/hook.js";
import { primer } from "../shared/primer.js";
import { stopTurn } from "../shared/stop.js";
import { waitIdle } from "../shared/waiter.js";
import type { PiSession, RunAnswer, SettleAnswer } from "./protocol.js";

/*
 * The worker's side of spec 009 D3 for one run, from its prompt to its
 * settling, on the shared hook code (D6). A consumer is `(session id, "main")`.
 */

const consumerInput = (session: PiSession) => ({ session_id: session.sessionId });

/** Pi's file writers (research, events 3): what `interrupt.onRegression` blocks. */
export const PI_EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

const SILENT_RUN: RunAnswer = { primer: null, news: null };

/**
 * `before_agent_start`: the primer for `systemPromptOptions.sections.squeal`,
 * naming the CLI as D7 says, and the run's news: a registered consumer's
 * `startTurn` delta, or, for one not registered (a store created after the
 * session started, an expiry while it sat idle), its registration header, as
 * 001's prompt registers. Nothing outside a repository that uses Squeal or
 * without a store the worker can open.
 */
export async function startRun(session: PiSession, deps: HookDeps): Promise<RunAnswer> {
  const location = locate(session.cwd);
  if (location === null || !usesSqueal(location)) return SILENT_RUN;
  const answer = await withContext(consumerInput(session), location, deps, async (context) => {
    const section = primer(deps.command, coverageOf(context));
    if (context.store.consumers.get(context.consumer) !== null) {
      const delta = await context.delivery.startTurn(context.consumer);
      return { primer: section, news: delta === null ? null : formatDelta(delta, deps.command) };
    }
    const now = (deps.now ?? Date.now)();
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    const startingSince =
      daemonLiveness(record, now).state === "alive"
        ? undefined
        : await ensureToRegister(location, deps, context);
    const registration = await context.delivery.register(context.consumer, {
      inTurn: true,
      ...(startingSince === undefined ? {} : { startingSince }),
    });
    return {
      primer: section,
      news: formatRegistration(registration, MESSAGE_CAP_CHARS, deps.command),
    };
  });
  return answer ?? SILENT_RUN;
}

/**
 * `tool_call`: on `edit` and `write`, with `interrupt.onRegression` on, an
 * undelivered regression blocks the call once (the shared PreToolUse deny);
 * on `bash`, spec 005 D8's opt-in test-command deny. The reason, or `null`.
 * Any other call opens nothing.
 */
export async function toolCall(
  call: PiSession & { readonly toolName: string; readonly command?: string },
  deps: HookDeps,
): Promise<string | null> {
  const location = locate(call.cwd);
  if (location === null) return null;
  const edit = PI_EDIT_TOOLS.has(call.toolName);
  const policy = readPolicy(location.root);
  // The shared recognizer knows the shell tool by Claude Code's and Codex's name.
  const testCommand =
    call.toolName === "bash"
      ? testCommandOf(location, policy, {
          toolName: "Bash",
          cwd: call.cwd,
          ...(call.command === undefined ? {} : { command: call.command }),
        })
      : null;
  if (!edit && testCommand === null) return null;
  return withContext(consumerInput(call), location, deps, async (context) => {
    const denied = edit
      ? await denyOnRegression(context, policy, {
          edit: true,
          toolName: call.toolName,
          command: deps.command,
        })
      : null;
    if (denied !== null || testCommand === null) return denied;
    return denyCurrentTestCommand(context, testCommand, (deps.now ?? Date.now)());
  });
}

/**
 * `agent_before_settle`, 002's Stop with `stop_hook_active` false (the
 * extension asks once per run): the news or the policy block to continue the
 * run with, or `null` when Stop was silent and so ended the turn. Pi has no
 * waiting Stop entry, so slow files are this Stop's whatever the policy:
 * `stopWaitRuns` finds no Pi entry ever recorded.
 */
export async function settle(session: PiSession, deps: HookDeps): Promise<SettleAnswer> {
  const location = locate(session.cwd);
  if (location === null) return { report: null };
  const outcome = await stopTurn(
    { ...consumerInput(session), stopHookActive: false, harness: "pi" },
    location,
    deps,
  );
  if (outcome === null) return { report: null };
  return { report: "block" in outcome ? outcome.block : outcome.news };
}

/** `agent_settled` after a run no settle ended: an abort, an error, or Squeal's own continuation. */
export async function endRun(session: PiSession, deps: HookDeps): Promise<null> {
  const location = locate(session.cwd);
  if (location === null) return null;
  await withContext(consumerInput(session), location, deps, async (context) => {
    await context.delivery.endTurn(context.consumer);
    return null;
  });
  return null;
}

/**
 * How long one idle wake waits: 001 D9's waiter bound (`WAITER_TIMEOUT_MS`
 * of the Claude Code adapter). Expiry is silent and the next settle re-arms.
 */
export const IDLE_WAIT_MS = 3_540_000;

/**
 * The idle wake (D5): 001 D9's waiter on the consumer, under its lock, until
 * the idle delta of the test files pending when the turn ended is non-empty;
 * that delta as text, or `null` at expiry, on `signal`, or with no store.
 */
export async function idleWait(
  session: PiSession,
  deps: HookDeps,
  signal?: AbortSignal,
): Promise<string | null> {
  const location = locate(session.cwd);
  if (location === null) return null;
  return waitIdle(
    consumerInput(session),
    location,
    deps,
    deps.waiterTimeoutMs ?? IDLE_WAIT_MS,
    signal,
  );
}
