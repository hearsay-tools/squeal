import { delimiter, resolve } from "node:path";
import type { OcClient, OcHooks } from "./api.js";
import { callBridge } from "./bridge-client.js";
import { type Deadline, deadlineIn, within } from "./deadline.js";
import { partAfter } from "./parts.js";
import type { OcConsumer, OcKind } from "./protocol.js";
import { keyOf, sessions } from "./sessions.js";
import { type Ask, storedBySqueal, turns } from "./turns.js";

/** Spec 008 D4: the deadline of `chat.message`, `tool.execute.before`, `tool.execute.after` and an event's call. */
export const EVENT_DEADLINE_MS = 2_000;
/** The longest `stop.waitMs` Stop honours (`STOP_WAIT_CAP_MS`, which the plugin bundle cannot import). */
export const STOP_WAIT_CAP_MS = 1_500;
/** D4: what the deadline at `session.idle` gives beyond `stop.waitMs`. */
export const IDLE_MARGIN_MS = 500;
/** D4: the deadline at `session.idle` at the longest wait, and while `stop.waitMs` is not known yet. */
export const IDLE_DEADLINE_MS = STOP_WAIT_CAP_MS + IDLE_MARGIN_MS;
/** D4: the deadline of `dispose`. */
export const DISPOSE_DEADLINE_MS = 3_000;
/** What `dispose` keeps for ending its consumers after an idle in flight stored its news. */
export const DISPOSE_END_MS = 500;
/** 001 D9: a root session's consumer is its main agent. */
export const MAIN_AGENT = "main";
/** D3: the primer's cap in the system prompt (002 D3). */
export const PRIMER_CAP_CHARS = 8_000;

/** Two texts for one place, a blank line between; `null` when neither is. */
const joined = (first: string | null, second: string | null): string | null =>
  first === null ? second : second === null ? first : `${first}\n\n${second}`;

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
  /** Root idles in flight, which `dispose` lets finish (goal 4 under `opencode run`). */
  const idling = new Set<Promise<void>>();
  let primer: string | null = null;
  /** `stop.waitMs`, from the last registration or prompt; `null` until one answers. */
  let stopWaitMs: number | null = null;
  let disposed = false;

  const ask: Ask = async (kind, request, deadline, options) => {
    const left = deadline();
    if (left <= 0) return null;
    const event = { kind, ...request, worktree: host.worktree, pid: host.pid };
    const command = { node: host.node, entry: host.bridge(kind) };
    return callBridge(command, event, host.directory, left, options);
  };
  const turn = turns(client, ask);

  /** The consumer of session `id`, or `null`; `null` too once disposed meanwhile (review 008-16 S1). */
  const identify = async (id: string, deadline: Deadline): Promise<OcConsumer | null> => {
    const consumer = await map.consumerOf(id, deadline);
    return disposed ? null : consumer;
  };

  /** News a cancelled continuation carried, once, for a root's next message or tool result (review 008-16 B2). */
  const held = (consumer: OcConsumer): string | null =>
    consumer.agentId === undefined ? turn.take(consumer.sessionId) : null;

  /** Registers `consumer` once per instance; its header, or `null`. */
  const register = (consumer: OcConsumer, deadline: Deadline): Promise<string | null> => {
    const key = keyOf(consumer);
    const run = (async () => {
      const answer = await ask("register", { consumer }, deadline);
      // A miss, or no consumer written (no store yet), leaves it unregistered: the next message tries again.
      if (answer === null || !answer.registered) return null;
      primer = answer.primer ?? primer;
      stopWaitMs = answer.stopWaitMs ?? stopWaitMs;
      registered.set(key, consumer);
      return disposed ? null : answer.header;
    })();
    registering.set(key, run);
    return run.finally(() => registering.delete(key));
  };

  /** The `tool.execute.before` reason to block, or `null`; never throws. */
  const blockReason = async (
    input: { tool: string; sessionID: string },
    args: unknown,
  ): Promise<string | null> => {
    try {
      if (disposed) return null;
      const deadline = deadlineIn(EVENT_DEADLINE_MS);
      const consumer = await identify(input.sessionID, deadline);
      if (consumer === null) return null;
      const { command, workdir } = (args ?? {}) as { command?: unknown; workdir?: unknown };
      // The shell runs in `workdir`, relative to the instance's directory, or in that directory.
      const bash =
        input.tool === "bash" && typeof command === "string"
          ? {
              command,
              workdir: resolve(host.directory, typeof workdir === "string" ? workdir : "."),
            }
          : {};
      const request = { consumer, tool: input.tool, ...bash };
      return (await ask("before", request, deadline))?.reason ?? null;
    } catch {
      return null;
    }
  };

  const idle = async (id: string): Promise<void> => {
    // D4: `stop.waitMs` plus 500 ms, the lookup, Stop and `promptAsync` within it (review 008-16 B1).
    const wait = Math.max(0, Math.min(stopWaitMs ?? STOP_WAIT_CAP_MS, STOP_WAIT_CAP_MS));
    const deadline = deadlineIn(wait + IDLE_MARGIN_MS);
    // Not `identify`: a `dispose` that began meanwhile waits for this idle, which registers nothing.
    const consumer = await map.consumerOf(id, deadline);
    if (consumer === null) return;
    if (consumer.agentId !== undefined) {
      // A child's idle is 002's SubagentStop: its consumer ends; a resumed child registers again.
      registered.delete(keyOf(consumer));
      await ask("end", { sessions: [], consumers: [consumer] }, deadline);
      return;
    }
    await turn.idle(consumer, deadline);
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
          // One deadline for the lookup and the end (review 008-16 B1).
          const deadline = deadlineIn(EVENT_DEADLINE_MS);
          const consumer = await identify(info.id, deadline);
          map.forget(info.id);
          turn.forget(info.id);
          if (consumer === null) return;
          const root = consumer.agentId === undefined;
          for (const [key, c] of registered) {
            if (key === keyOf(consumer) || (root && c.sessionId === info.id))
              registered.delete(key);
          }
          const request = root
            ? { sessions: [info.id], consumers: [] }
            : { sessions: [], consumers: [consumer] };
          await ask("end", request, deadline);
        } else if (event.type === "session.error" && sessionID !== undefined) {
          if (error?.name === "MessageAbortedError") turn.aborted(sessionID);
        } else if (event.type === "session.idle" && sessionID !== undefined) {
          const ending = idle(sessionID);
          idling.add(ending);
          await ending.finally(() => idling.delete(ending));
        }
      } catch {
        // D4: silence.
      }
    },

    async "chat.message"(input, output) {
      try {
        // The report the instance before this one stored at its `dispose` (`turns`) is not a prompt.
        if (disposed || storedBySqueal(output.parts)) return;
        const deadline = deadlineIn(EVENT_DEADLINE_MS);
        const consumer = await identify(input.sessionID, deadline);
        if (consumer === null) return;
        // D5: a message, the user's or Squeal's own, ends the idle wait.
        if (consumer.agentId === undefined) turn.message(consumer.sessionId, output.parts);
        const key = keyOf(consumer);
        let text: string | null;
        if (registered.has(key)) {
          const answer = await ask("prompt", { consumer }, deadline);
          primer = answer?.primer ?? primer;
          stopWaitMs = answer?.stopWaitMs ?? stopWaitMs;
          text = answer?.text ?? null;
        } else {
          const inFlight = registering.get(key);
          if (inFlight !== undefined) {
            await within(inFlight, deadline());
            return;
          }
          text = await register(consumer, deadline);
        }
        if (disposed) return;
        // D3 as amended: without an id that sorts last OpenCode fails the prompt, so nothing is added.
        const id = partAfter(output.parts);
        if (id === null) return;
        const added = joined(held(consumer), text);
        if (added === null) return;
        const { message } = output;
        output.parts.push({
          id,
          sessionID: message.sessionID,
          messageID: message.id,
          type: "text",
          text: added,
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
        const consumer = await identify(input.sessionID, deadline);
        if (consumer === null) return;
        // A consumer first registered here gets the primer too (008-22).
        const request = {
          consumer,
          tool: input.tool,
          ...(primer === null ? { primer: true as const } : {}),
        };
        const answer = await ask("after", request, deadline);
        primer = answer?.primer ?? primer;
        stopWaitMs = answer?.stopWaitMs ?? stopWaitMs;
        const text = answer?.text ?? null;
        if (disposed) return;
        const added = joined(held(consumer), text);
        if (added !== null) output.output = `${output.output}\n\n${added}`;
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
        const consumer = await identify(input.sessionID, deadlineIn(EVENT_DEADLINE_MS));
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
        const deadline = deadlineIn(DISPOSE_DEADLINE_MS);
        // An idle in flight stores its news (`turns`): OpenCode awaits `dispose`, and `opencode
        // run` disposes about 10 ms after the turn's idle (008-25).
        turn.stop(() => deadline() - DISPOSE_END_MS);
        // S1: a registration in flight lands first, and so does an idle in flight.
        await within(Promise.all([...registering.values(), ...idling]), deadline());
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
