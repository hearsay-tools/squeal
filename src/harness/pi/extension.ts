import type { Worker } from "node:worker_threads";
import type { CustomMessageEntryDraft } from "@earendil-works/pi-coding-agent";
import type { PiApi, PiContext, PiCustomMessage } from "./api.js";
import { createDeliveryHost, type DeliveryHost, type PendingWait } from "./host.js";
import type { PiAnswers, PiRequest, PiSession } from "./protocol.js";

/** Spec 009 D4: the deadline of `session_start`, `turn_end`, `tool_call` and `before_agent_start`. */
export const EVENT_DEADLINE_MS = 2_000;
/** D4: the deadline of `session_shutdown`. */
export const SHUTDOWN_DEADLINE_MS = 3_000;
/**
 * D4: the deadline of `agent_before_settle`, `stop.waitMs` plus 500 ms at
 * the longest wait Stop honours (`STOP_WAIT_CAP_MS`, 1,500 ms): the main
 * thread reads no policy, and a Stop that waits less answers sooner.
 */
export const SETTLE_DEADLINE_MS = 2_000;
/** The deadline of `agent_settled`'s end of a turn: one store write, as a tool boundary. */
export const END_TURN_DEADLINE_MS = EVENT_DEADLINE_MS;

/** D3: every entry Squeal adds is a displayed custom message of this type. */
export const CUSTOM_TYPE = "squeal";
/** D3: the system-prompt section the primer goes in, and its cap (002 D3). */
export const PRIMER_SECTION = "squeal";
export const PRIMER_SECTION_CAP_CHARS = 8_000;

/** Pi's tools that change no file (research, events 3): a batch of only these edited nothing. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls"]);
/** The calls `tool_call` asks the worker about: the writers, and `bash` for 005 D8. */
const ASKED_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "bash"]);
/** D5: the modes that stay open after a run, where an idle agent can be woken. */
const WAKE_MODES: ReadonlySet<string> = new Set(["tui", "rpc"]);

/**
 * D2: the session a handler is about, read from its context on every event.
 * `null` when the context cannot say (Pi throws once a context is stale).
 */
export function sessionOf(ctx: PiContext): PiSession | null {
  try {
    return { sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd };
  } catch {
    return null;
  }
}

const message = (content: string): PiCustomMessage => ({
  customType: CUSTOM_TYPE,
  content,
  display: true,
});

const entry = (content: string): CustomMessageEntryDraft => ({
  type: "custom_message",
  ...message(content),
});

/** The request of kind `K` about a session, without the session's fields. */
type About<K extends PiRequest["kind"]> = Omit<Extract<PiRequest, { kind: K }>, keyof PiSession> & {
  readonly kind: K;
};

/**
 * The Squeal extension factory on `start`, which creates the delivery worker
 * (spec 009 D3, D4). Pi calls the factory once per extension instance: at
 * load, and again in the same module after each session replacement or
 * reload, so everything here is per instance.
 *
 * - `session_start` starts the delivery host and registers once per session
 *   id (RPC delivers it twice per replacement, D2), then queues the header
 *   for the next prompt at no extra request.
 * - `input` and `before_agent_start` start a run: Squeal has neither
 *   continued nor ended it, and the idle wake is cancelled. `before_agent_start` sets the primer section,
 *   the last one the worker gave when this call gives none, and returns the
 *   run's news as its message.
 * - `turn_end` after tool calls delivers the delta as one entry; the final
 *   `turn_end`, with no tool calls, delivers nothing (the settle speaks).
 * - `tool_call` blocks an `edit` or `write` over an undelivered regression,
 *   and a `bash` test command under 005 D8, with the worker's reason.
 * - `agent_before_settle` of a completed run Squeal has not continued is
 *   002's Stop: a report continues the run once; silence ended the turn.
 * - `agent_settled` ends the turn when no settle did: an abort, an error,
 *   a missed deadline, or the end of Squeal's continuation. Then, in `tui`
 *   and `rpc`, it arms the idle wake (D5): the idle delta, once there is
 *   one, starts a run as a follow-up. Under `-p` and `json` Pi exits.
 * - `session_shutdown` cancels the wake and unregisters the outgoing
 *   session, except on `reload`, whose next instance takes it over, then
 *   stops the host. After it every event of the instance is silent.
 *
 * No handler throws or outlasts its deadline: a miss is silence (D4).
 */
export function squealExtension(start: () => Worker): (pi: PiApi) => void {
  return (pi) => {
    let host: DeliveryHost | null = null;
    let shutDown = false;
    const started = new Set<string>();
    // The run's state: Squeal's continuation flag (002's `stop_hook_active`), and a turn already ended.
    let continued = false;
    let ended = false;
    let lastPrimer: string | null = null;
    let waiting: PendingWait | null = null;

    /** Asks the worker about `ctx`'s session; `null` after shutdown, before a start, or on a miss. */
    const ask = async <K extends PiRequest["kind"]>(
      ctx: PiContext,
      request: About<K>,
      deadlineMs: number,
    ): Promise<PiAnswers[K] | null> => {
      try {
        const session = sessionOf(ctx);
        if (shutDown || host === null || session === null) return null;
        const answer = await host.call({ ...request, ...session } as PiRequest, deadlineMs);
        return shutDown ? null : (answer as PiAnswers[K] | null);
      } catch {
        return null;
      }
    };

    const cancelWait = () => {
      waiting?.cancel();
      waiting = null;
    };

    const startRun = () => {
      cancelWait();
      continued = false;
      ended = false;
    };

    /** D5: in a mode that stays open, waits for the idle delta and wakes the agent with it. */
    const armWait = (ctx: PiContext) => {
      cancelWait();
      let mode: string;
      try {
        mode = ctx.mode;
      } catch {
        return;
      }
      const session = sessionOf(ctx);
      if (shutDown || host === null || session === null || !WAKE_MODES.has(mode)) return;
      const wait = host.wait({ kind: "wait", ...session });
      waiting = wait;
      void wait.answer.then((text) => {
        if (waiting !== wait) return;
        waiting = null;
        if (text === null || shutDown) return;
        try {
          pi.sendMessage(message(text), { triggerTurn: true, deliverAs: "followUp" });
        } catch {
          // D4: silence; the news waits for the next prompt.
        }
      });
    };

    pi.on("session_start", async (event, ctx) => {
      try {
        const session = sessionOf(ctx);
        if (shutDown || session === null || started.has(session.sessionId)) return;
        started.add(session.sessionId);
        host ??= createDeliveryHost(start);
        const text = await ask(ctx, { kind: "start", reason: event.reason }, EVENT_DEADLINE_MS);
        if (text === null) return;
        pi.sendMessage(message(text), { deliverAs: "nextTurn" });
      } catch {
        // D4: silence; Pi would print a thrown error as an extension error.
      }
    });

    pi.on("input", () => {
      startRun();
      return undefined;
    });

    pi.on("before_agent_start", async (event, ctx) => {
      startRun();
      const answer = await ask(ctx, { kind: "run" }, EVENT_DEADLINE_MS);
      try {
        lastPrimer = answer?.primer ?? lastPrimer;
        if (lastPrimer !== null && !shutDown) {
          event.systemPromptOptions.sections[PRIMER_SECTION] = lastPrimer.slice(
            0,
            PRIMER_SECTION_CAP_CHARS,
          );
        }
      } catch {
        // A frozen options object: the run goes without the primer.
      }
      return answer?.news == null ? undefined : { message: message(answer.news) };
    });

    pi.on("turn_end", async (event, ctx) => {
      const tools = event.toolResults.map((result) => result.toolName);
      if (tools.length === 0) return undefined;
      const edited = tools.some((name) => !READ_ONLY_TOOLS.has(name));
      const text = await ask(ctx, { kind: "boundary", edited }, EVENT_DEADLINE_MS);
      return text === null ? undefined : { entries: [entry(text)] };
    });

    pi.on("tool_call", async (event, ctx) => {
      if (!ASKED_TOOLS.has(event.toolName)) return undefined;
      const input: Record<string, unknown> = event.input;
      const command =
        event.toolName === "bash" && typeof input.command === "string"
          ? { command: input.command }
          : {};
      const reason = await ask(
        ctx,
        { kind: "toolCall", toolName: event.toolName, ...command },
        EVENT_DEADLINE_MS,
      );
      return reason === null ? undefined : { block: true, reason };
    });

    pi.on("agent_before_settle", async (event, ctx) => {
      if (continued || ended || event.outcome !== "completed") return undefined;
      const answer = await ask(ctx, { kind: "settle" }, SETTLE_DEADLINE_MS);
      if (answer === null) return undefined;
      if (answer.report === null) {
        ended = true;
        return undefined;
      }
      continued = true;
      return { entries: [entry(answer.report)], continue: true };
    });

    pi.on("agent_settled", async (_event, ctx) => {
      if (!ended) {
        ended = true;
        await ask(ctx, { kind: "endTurn" }, END_TURN_DEADLINE_MS);
      }
      armWait(ctx);
    });

    pi.on("session_shutdown", async (event, ctx) => {
      if (shutDown) return;
      shutDown = true;
      cancelWait();
      const running = host;
      host = null;
      if (running === null) return;
      try {
        const session = sessionOf(ctx);
        if (event.reason !== "reload" && session !== null) {
          await running.call({ kind: "shutdown", ...session }, SHUTDOWN_DEADLINE_MS);
        }
      } catch {
        // Silence; daemon-side expiry catches a consumer left registered (001 D10).
      } finally {
        running.stop();
      }
    });
  };
}
