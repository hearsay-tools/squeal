import { readPolicy } from "../../core/daemon/policy.js";
import { endTurn as idleAt } from "../../core/delivery/turn.js";
import { type HookContext, locate } from "../shared/context.js";
import { coverageOf } from "../shared/coverage.js";
import { deliver } from "../shared/deliver.js";
import { denyCurrentTestCommand, denyOnRegression, testCommandOf } from "../shared/deny.js";
import { withContext } from "../shared/hook.js";
import { primer } from "../shared/primer.js";
import { stopTurn } from "../shared/stop.js";
import { waitIdle } from "../shared/waiter.js";
import { consumerInput, type OcHandler } from "./bridge.js";

/*
 * The bridge's side of spec 008 D3 within a turn, from its first tool call
 * to its idle, and the idle wake of D5, on the shared hook code (D6).
 */

/** OpenCode's file writers (research, plugins 4): what `interrupt.onRegression` blocks. */
export const OPENCODE_EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "apply_patch"]);

/**
 * OpenCode 1.18.35's built-in tools that change no file. Any other tool may:
 * the writers, `bash`, `task` (a child's edits) and a plugin's or MCP
 * server's tool.
 */
export const OPENCODE_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "glob",
  "list",
  "webfetch",
  "websearch",
  "codesearch",
  "todoread",
  "todowrite",
  "skill",
  "question",
]);

/**
 * `tool.execute.before` (D3): an idle consumer is put back in a turn
 * (001-93); on `edit`, `write` and `apply_patch`, with
 * `interrupt.onRegression` on, an undelivered regression blocks the call
 * once; on `bash`, spec 005 D8's opt-in test-command deny, after it. The
 * reason, or `null`.
 */
export const before: OcHandler<"before"> = async (request, deps) => {
  const location = locate(request.worktree);
  if (location === null) return { reason: null };
  const policy = readPolicy(location.root);
  // The shared recognizer knows the shell tool by Claude Code's and Codex's name.
  const testCommand =
    request.tool === "bash" && request.command !== undefined
      ? testCommandOf(location, policy, {
          toolName: "Bash",
          cwd: request.workdir ?? request.worktree,
          command: request.command,
        })
      : null;
  const reason = await withContext(
    consumerInput(request.consumer),
    location,
    deps,
    async (context) =>
      (await denyOnRegression(context, policy, {
        edit: OPENCODE_EDIT_TOOLS.has(request.tool),
        toolName: request.tool,
        command: deps.command,
      })) ??
      (testCommand === null
        ? null
        : denyCurrentTestCommand(context, testCommand, (deps.now ?? Date.now)())),
  );
  return { reason };
};

/**
 * `tool.execute.after` (D3), the primary push: once per call, so the
 * delivery view keeps it idempotent; the second call of a parallel batch
 * finds nothing undelivered. A consumer not registered is registered here,
 * so, asked, the answer carries the primer and `stop.waitMs` as `register`'s
 * does: a session whose first message found no store gets them (008-22).
 */
export const after: OcHandler<"after"> = async (request, deps) => {
  const location = locate(request.worktree);
  if (location === null) return { text: null };
  const edited = !OPENCODE_READ_ONLY_TOOLS.has(request.tool);
  const answer = await withContext(
    consumerInput(request.consumer),
    location,
    deps,
    async (context) => {
      const text = await deliver(context, deps, edited);
      if (request.primer !== true) return { text };
      return {
        text,
        primer: primer(deps.command, coverageOf(context)),
        stopWaitMs: readPolicy(location.root).stop.waitMs,
      };
    },
  );
  return answer ?? { text: null };
};

/**
 * `session.idle` of a root session Squeal has not continued: 002's Stop with
 * `stop_hook_active` false. The news or the policy block to continue the
 * turn with, or `null` when Stop was silent and so ended the turn. OpenCode,
 * as Pi, has no waiting Stop entry, so slow files are this Stop's whatever
 * the policy: `stopWaitRuns` finds no entry recorded under Pi's name either.
 */
export const stop: OcHandler<"stop"> = async (request, deps) => {
  const location = locate(request.worktree);
  if (location === null) return { report: null };
  const outcome = await stopTurn(
    { ...consumerInput(request.consumer), stopHookActive: false, harness: "pi" },
    location,
    deps,
  );
  if (outcome === null) return { report: null };
  return { report: "block" in outcome ? outcome.block : outcome.news };
};

/**
 * The end of a continued turn: idle, waiting for the test files pending now
 * only. Unlike `delivery.endTurn`, not for the files of entries undelivered
 * now: news known by the continued turn's idle waits for the next prompt, so
 * the wake does not continue it again (goal 4, lessons defect 5).
 */
const endContinued = ({ store, consumer }: HookContext): boolean =>
  store.transaction(() => {
    if (store.consumers.get(consumer) === null) return true;
    idleAt(store, consumer, store.knownStates.list(consumer.worktreeId), []);
    return true;
  });

/** `session.idle` after Squeal's own continuation or an abort: end the turn, say nothing. */
export const endTurn: OcHandler<"endTurn"> = async (request, deps) => {
  const location = locate(request.worktree);
  if (location === null) return { ended: false };
  const ended = await withContext(
    consumerInput(request.consumer),
    location,
    deps,
    async (context) =>
      request.continued === true
        ? endContinued(context)
        : context.delivery.endTurn(context.consumer),
  );
  return { ended: ended ?? false };
};

/**
 * How long one idle wake waits: 001 D9's waiter bound, as Pi's. Expiry is
 * silent, and the next idle arms another.
 */
export const IDLE_WAIT_MS = 3_540_000;

/** How often the waiter checks that OpenCode's process still lives. */
export const PID_POLL_MS = 1_000;

/** Whether `pid` names a live process. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The idle wake (D5): 001 D9's waiter on the consumer, under its lock, until
 * the idle delta of the test files pending when the turn ended is non-empty;
 * that delta as text, or `null` at expiry, once OpenCode's process is gone,
 * or with no store. The plugin kills it at a user message and at `dispose`.
 */
export const wait: OcHandler<"wait"> = async (request, deps) => {
  const location = locate(request.worktree);
  if (location === null) return { text: null };
  const gone = new AbortController();
  const watch = setInterval(() => {
    if (!alive(request.pid)) gone.abort();
  }, PID_POLL_MS);
  watch.unref();
  try {
    const text = await waitIdle(
      consumerInput(request.consumer),
      location,
      deps,
      deps.waiterTimeoutMs ?? IDLE_WAIT_MS,
      gone.signal,
    );
    return { text };
  } finally {
    clearInterval(watch);
  }
};
