import { delimiter } from "node:path";
import type { OcClient, OcHooks } from "./api.js";
import { type CallOptions, callBridge } from "./bridge-client.js";
import { type Deadline, deadlineIn, within } from "./deadline.js";
import { partAfter } from "./parts.js";
import type { OcAnswers, OcConsumer, OcKind, OcRequest } from "./protocol.js";
import { keyOf, sessions } from "./sessions.js";

/** Spec 008 D4: the deadline of `chat.message`, `tool.execute.before`, `tool.execute.after` and an event's call. */
export const EVENT_DEADLINE_MS = 2_000;
/** D4: the deadline at `session.idle`, `stop.waitMs` plus 500 ms at the longest wait Stop honours (1,500 ms). */
export const IDLE_DEADLINE_MS = 2_000;
/** D4: the deadline of `dispose`. */
export const DISPOSE_DEADLINE_MS = 3_000;
/** D5: the waiter's own bound (`IDLE_WAIT_MS`, 59 minutes) and a minute; it exits first. */
export const WAIT_DEADLINE_MS = 3_600_000;
/** 001 D9: a root session's consumer is its main agent. */
export const MAIN_AGENT = "main";
/** D3: the primer's cap in the system prompt (002 D3). */
export const PRIMER_CAP_CHARS = 8_000;

/** How the hooks reach the bridge and OpenCode. */
export interface HookHost {
  readonly node: string;
  /** The bridge entry of each kind (`dist/hooks/<kind>.mjs`). */
  readonly bridge: (kind: OcKind) => string;
  readonly client: OcClient;
  readonly directory: string;
  readonly worktree: string;
  /** OpenCode's process (D2). */
  readonly pid: number;
  /** The package's `bin/`, prepended to the agent shell's `PATH` (D2). */
  readonly bin: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** A root session's turn (D3) and its idle wait (D5). */
interface Turn {
  /** Squeal continued or woke this turn: its idle ends the turn, silent (002's `stop_hook_active`). */
  continued: boolean;
  /** A `MessageAbortedError` came since the last idle (002's Interrupt). */
  aborted: boolean;
  /** The text Squeal last sent, so its `chat.message` is known as Squeal's own. */
  own: string | null;
  waiter: AbortController | null;
}

/** The request of kind `K`, without what every request carries. */
type About<K extends OcKind> = Omit<Extract<OcRequest, { kind: K }>, "kind" | "worktree" | "pid">;

const textOf = (part: unknown): string | null => {
  const p = part as { type?: unknown; text?: unknown } | null;
  return p?.type === "text" && typeof p.text === "string" ? p.text : null;
};

/**
 * The hooks of spec 008 D3 for one plugin instance. No hook throws, except
 * `tool.execute.before` to block an edit, or outlasts its deadline: a miss
 * is silence (D4). After `dispose` every hook is silent.
 */
export function squealHooks(host: HookHost): OcHooks {
  const { client } = host;
  const map = sessions(client);
  /** Consumers this instance registered, by `keyOf`, and registrations in flight. */
  const registered = new Map<string, OcConsumer>();
  const registering = new Map<string, Promise<string | null>>();
  const turns = new Map<string, Turn>();
  let primer: string | null = null;
  let disposed = false;

  const ask = async <K extends OcKind>(
    kind: K,
    request: About<K>,
    deadline: Deadline,
    options?: CallOptions,
  ): Promise<OcAnswers[K] | null> => {
    const left = deadline();
    if (left <= 0) return null;
    const event = { kind, ...request, worktree: host.worktree, pid: host.pid };
    const command = { node: host.node, entry: host.bridge(kind) };
    return callBridge<OcAnswers[K]>(command, event, host.directory, left, options);
  };

  const turnOf = (id: string): Turn => {
    let turn = turns.get(id);
    if (turn === undefined) {
      turn = { continued: false, aborted: false, own: null, waiter: null };
      turns.set(id, turn);
    }
    return turn;
  };

  const cancelWait = (turn: Turn) => {
    turn.waiter?.abort();
    turn.waiter = null;
  };

  /** Starts one more turn with `text` (D3's continuation, D5's wake); whether OpenCode took it. */
  const say = async (id: string, turn: Turn, text: string): Promise<boolean> => {
    turn.continued = true;
    turn.own = text;
    const result = await within(
      client.session.promptAsync({ path: { id }, body: { parts: [{ type: "text", text }] } }),
      EVENT_DEADLINE_MS,
    );
    if (result !== null && result.error === undefined) return true;
    turn.own = null;
    return false;
  };

  /** D5: after a root's idle, waits for the idle delta and wakes the agent with it, once. */
  const armWait = (consumer: OcConsumer, turn: Turn) => {
    cancelWait(turn);
    if (disposed) return;
    const waiter = new AbortController();
    turn.waiter = waiter;
    const options = { signal: waiter.signal, background: true };
    void ask("wait", { consumer }, deadlineIn(WAIT_DEADLINE_MS), options)
      .then(async (answer) => {
        if (turn.waiter !== waiter) return;
        turn.waiter = null;
        if (answer?.text == null || disposed) return;
        await say(consumer.sessionId, turn, answer.text);
      })
      .catch(() => {});
  };

  /** Registers `consumer` once per instance; its header, or `null`. */
  const register = (consumer: OcConsumer, deadline: Deadline): Promise<string | null> => {
    const key = keyOf(consumer);
    const run = (async () => {
      const answer = await ask("register", { consumer }, deadline);
      // A miss, or no consumer written (no store yet), leaves it unregistered: the next message tries again.
      if (answer === null || !answer.registered) return null;
      primer = answer.primer ?? primer;
      registered.set(key, consumer);
      return disposed ? null : answer.header;
    })();
    registering.set(key, run);
    return run.finally(() => registering.delete(key));
  };

  /** Whether `parts` are the message Squeal last sent in `turn`. */
  const isOwn = (turn: Turn, parts: readonly unknown[]): boolean => {
    if (turn.own === null || !parts.some((part) => textOf(part) === turn.own)) return false;
    turn.own = null;
    return true;
  };

  /** The `tool.execute.before` reason to block, or `null`; never throws. */
  const blockReason = async (
    input: { tool: string; sessionID: string },
    args: unknown,
  ): Promise<string | null> => {
    try {
      if (disposed) return null;
      const deadline = deadlineIn(EVENT_DEADLINE_MS);
      const consumer = await map.consumerOf(input.sessionID, deadline);
      if (consumer === null) return null;
      const { command, workdir } = (args ?? {}) as { command?: unknown; workdir?: unknown };
      const request = {
        consumer,
        tool: input.tool,
        ...(input.tool === "bash" && typeof command === "string" ? { command } : {}),
        ...(typeof workdir === "string" ? { workdir } : {}),
      };
      return (await ask("before", request, deadline))?.reason ?? null;
    } catch {
      return null;
    }
  };

  const idle = async (id: string): Promise<void> => {
    const deadline = deadlineIn(IDLE_DEADLINE_MS);
    const consumer = await map.consumerOf(id, deadline);
    if (consumer === null) return;
    if (consumer.agentId !== undefined) {
      // A child's idle is 002's SubagentStop: its consumer ends; a resumed child registers again.
      registered.delete(keyOf(consumer));
      await ask("end", { sessions: [], consumers: [consumer] }, deadline);
      return;
    }
    const turn = turnOf(id);
    if (turn.aborted || turn.continued) {
      turn.aborted = false;
      await ask("endTurn", { consumer }, deadline);
    } else {
      const report = (await ask("stop", { consumer }, deadline))?.report ?? null;
      if (report !== null && !disposed && (await say(id, turn, report))) return;
    }
    armWait(consumer, turn);
  };

  return {
    async event({ event }) {
      try {
        if (disposed) return;
        const { info, sessionID, error } = event.properties;
        if (event.type === "session.created" && info !== undefined) {
          map.saw(info);
        } else if (event.type === "session.deleted" && info !== undefined) {
          map.saw(info);
          const consumer = await map.consumerOf(info.id, deadlineIn(EVENT_DEADLINE_MS));
          map.forget(info.id);
          const turn = turns.get(info.id);
          if (turn !== undefined) cancelWait(turn);
          turns.delete(info.id);
          if (consumer === null) return;
          const root = consumer.agentId === undefined;
          for (const [key, c] of registered) {
            if (key === keyOf(consumer) || (root && c.sessionId === info.id))
              registered.delete(key);
          }
          const request = root
            ? { sessions: [info.id], consumers: [] }
            : { sessions: [], consumers: [consumer] };
          await ask("end", request, deadlineIn(EVENT_DEADLINE_MS));
        } else if (event.type === "session.error" && sessionID !== undefined) {
          if (error?.name === "MessageAbortedError") turnOf(sessionID).aborted = true;
        } else if (event.type === "session.idle" && sessionID !== undefined) {
          await idle(sessionID);
        }
      } catch {
        // D4: silence.
      }
    },

    async "chat.message"(input, output) {
      try {
        if (disposed) return;
        const deadline = deadlineIn(EVENT_DEADLINE_MS);
        const consumer = await map.consumerOf(input.sessionID, deadline);
        if (consumer === null) return;
        if (consumer.agentId === undefined) {
          // D5: a message, the user's or Squeal's own, ends the idle wait.
          const turn = turnOf(consumer.sessionId);
          cancelWait(turn);
          if (!isOwn(turn, output.parts)) turn.continued = false;
        }
        const key = keyOf(consumer);
        let text: string | null;
        if (registered.has(key)) {
          text = (await ask("prompt", { consumer }, deadline))?.text ?? null;
        } else {
          const inFlight = registering.get(key);
          if (inFlight !== undefined) {
            await within(inFlight, deadline());
            return;
          }
          text = await register(consumer, deadline);
        }
        if (text === null || disposed) return;
        // D3 as amended: without an id that sorts last OpenCode fails the prompt, so nothing is added.
        const id = partAfter(output.parts);
        if (id === null) return;
        const { message } = output;
        output.parts.push({
          id,
          sessionID: message.sessionID,
          messageID: message.id,
          type: "text",
          text,
          synthetic: true,
        });
      } catch {
        // D4: silence.
      }
    },

    async "experimental.chat.system.transform"(_input, output) {
      try {
        if (disposed || primer === null) return;
        output.system.push(primer.slice(0, PRIMER_CAP_CHARS));
      } catch {
        // A frozen output: the request goes without the primer.
      }
    },

    async "tool.execute.before"(input, output) {
      const reason = await blockReason(input, output.args);
      // D3: a throw is the deny; the model sees a failed call and may re-issue it.
      if (reason !== null) throw new Error(reason);
    },

    async "tool.execute.after"(input, output) {
      try {
        if (disposed || typeof output.output !== "string") return;
        const deadline = deadlineIn(EVENT_DEADLINE_MS);
        const consumer = await map.consumerOf(input.sessionID, deadline);
        if (consumer === null) return;
        const text = (await ask("after", { consumer, tool: input.tool }, deadline))?.text ?? null;
        if (text !== null && !disposed) output.output = `${output.output}\n\n${text}`;
      } catch {
        // D4: silence.
      }
    },

    async "shell.env"(input, output) {
      try {
        if (disposed) return;
        const path = output.env.PATH ?? host.env.PATH;
        output.env.PATH =
          path === undefined || path === "" ? host.bin : `${host.bin}${delimiter}${path}`;
        if (input.sessionID === undefined) return;
        const consumer = await map.consumerOf(input.sessionID, deadlineIn(EVENT_DEADLINE_MS));
        if (consumer === null) return;
        output.env.OPENCODE_SESSION_ID = consumer.sessionId;
        output.env.OPENCODE_AGENT_ID = consumer.agentId ?? MAIN_AGENT;
      } catch {
        // D4: silence; the shell runs with what it has.
      }
    },

    async dispose() {
      try {
        if (disposed) return;
        disposed = true;
        for (const turn of turns.values()) cancelWait(turn);
        const deadline = deadlineIn(DISPOSE_DEADLINE_MS);
        // S1: a registration in flight lands first. Its own deadline (2 s) ends within this one.
        await within(Promise.all(registering.values()), deadline());
        const consumers = [...registered.values()];
        registered.clear();
        if (consumers.length === 0) return;
        await ask("end", { sessions: [], consumers }, deadline);
      } catch {
        // Silence; a consumer left registered ends with OpenCode's process (001 D10).
      }
    },
  };
}
