import { delimiter } from "node:path";
import type { OcClient, OcHooks, OcPlugin, OcSessionInfo, OcTextPart } from "./api.js";
import { type BridgeCommand, callBridge } from "./bridge-client.js";
import { findNode, usesSquealAt } from "./host.js";
import type { OcAnswers, OcConsumer, OcRequest } from "./protocol.js";

/** Spec 008 D4: the deadline of `chat.message`, `tool.execute.before`, `tool.execute.after` and an event's call. */
export const EVENT_DEADLINE_MS = 2_000;
/** D4: the deadline of `dispose`. */
export const DISPOSE_DEADLINE_MS = 3_000;
/** 001 D9: a root session's consumer is its main agent. */
export const MAIN_AGENT = "main";
/** `client.app.log`'s service name. */
export const LOG_SERVICE = "squeal";
/** The line logged when no Node of Squeal's minimum is on the PATH (D4). */
export const NO_NODE_LOG =
  "Squeal: no Node 22.13 or later on the PATH, so Squeal is off in this OpenCode process.";

/** A `task` child of a child is one more hop; the walk to the root stops here. */
const MAX_DEPTH = 8;

export interface SquealPluginOptions {
  /** The bridge entry, `dist/hooks/opencode.mjs` (D1). */
  readonly entry: string;
  /** The package's `bin/`, prepended to the agent shell's `PATH` (D2). */
  readonly bin: string;
  /** Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Default `findNode`. */
  readonly findNode?: (env: Readonly<Record<string, string | undefined>>) => Promise<string | null>;
  /** OpenCode's process (D2). Default `process.pid`. */
  readonly pid?: number;
}

/** A hook's one deadline (D4): what is left of it, for each wait in the hook. */
export type Deadline = () => number;

/** The deadline `ms` from now. */
export function deadlineIn(ms: number): Deadline {
  const end = performance.now() + ms;
  return () => Math.max(0, end - performance.now());
}

/** Resolves `promise`, or `null` past `ms` or on a rejection. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * A part id OpenCode accepts (`prt_` and its ascending identifier: 12 hex
 * digits of time and a counter, then 14 base62 characters), so the part
 * sorts after the message's own.
 */
export function partId(now: number = Date.now()): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const time = (BigInt(now) * 0x1000n + 0xfffn).toString(16).padStart(12, "0").slice(-12);
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `prt_${time}${Array.from(bytes, (byte) => chars[byte % 62]).join("")}`;
}

const keyOf = (consumer: OcConsumer) => `${consumer.sessionId}\n${consumer.agentId ?? ""}`;

/**
 * The Squeal plugin (spec 008 D2 to D4). OpenCode calls it once per instance
 * (a directory). Outside a Squeal repository, and without a Node to run the
 * bridge, it returns no hooks. Otherwise:
 *
 * - `event` keeps the session map (D2): `session.created` records each
 *   session's parent; `session.deleted` ends a root session whole, or a
 *   child's consumer alone.
 * - `chat.message` registers the message's consumer once per instance, a
 *   root as `(session, "main")` and a child as `(root, child)`, and adds the
 *   registration header to the message as one synthetic text part.
 * - `shell.env` names the consumer in the agent's shell
 *   (`OPENCODE_SESSION_ID`, `OPENCODE_AGENT_ID`) and puts the package's
 *   `bin/` first on its `PATH`.
 * - `dispose` unregisters what this instance registered, within its
 *   deadline; after it every hook is silent.
 *
 * No hook throws or outlasts its deadline: a miss is silence (D4).
 */
export function squealPlugin(options: SquealPluginOptions): OcPlugin {
  return async (input) => {
    try {
      const env = options.env ?? process.env;
      if (!usesSquealAt(input.directory) && !usesSquealAt(input.worktree)) return {};
      const node = await (options.findNode ?? findNode)(env);
      if (node === null) {
        log(input.client, NO_NODE_LOG);
        return {};
      }
      return hooks(
        { node, entry: options.entry },
        input.client,
        input.directory,
        input.worktree,
        options,
      );
    } catch {
      return {};
    }
  };
}

function log(client: OcClient, message: string): void {
  try {
    client.app.log({ body: { service: LOG_SERVICE, level: "warn", message } }).catch(() => {});
  } catch {
    // No log either: still no hooks.
  }
}

function hooks(
  bridge: BridgeCommand,
  client: OcClient,
  directory: string,
  worktree: string,
  options: SquealPluginOptions,
): OcHooks {
  const env = options.env ?? process.env;
  const pid = options.pid ?? process.pid;
  /** Session id to parent id, `null` for a root (D2). */
  const parents = new Map<string, string | null>();
  /** Consumers this instance registered, by `keyOf`, and registrations in flight. */
  const registered = new Map<string, OcConsumer>();
  const registering = new Map<string, Promise<void>>();
  let disposed = false;

  /** The request of kind `K`, without what every request carries. */
  type About<K extends OcRequest["kind"]> = Omit<
    Extract<OcRequest, { kind: K }>,
    "kind" | "worktree" | "pid"
  >;
  const ask = async <K extends OcRequest["kind"]>(
    kind: K,
    request: About<K>,
    deadline: Deadline,
  ): Promise<OcAnswers[K] | null> => {
    const left = deadline();
    if (left <= 0) return null;
    return callBridge<OcAnswers[K]>(bridge, { kind, ...request, worktree, pid }, directory, left);
  };

  /** The parent of `id`, from the map or one `client.session.get`; `null` for a root or an unknown. */
  const parentOf = async (id: string, deadline: Deadline): Promise<string | null> => {
    const known = parents.get(id);
    if (known !== undefined) return known;
    const result = await within<{ data?: OcSessionInfo }>(
      client.session.get({ path: { id } }),
      deadline(),
    );
    if (result?.data === undefined) return null;
    const parent = result.data.parentID ?? null;
    parents.set(id, parent);
    return parent;
  };

  /** D2: a root session's consumer is `(id, main)`; a child's is `(root, child)`. */
  const consumerOf = async (sessionId: string, deadline: Deadline): Promise<OcConsumer> => {
    let root = sessionId;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const parent = await parentOf(root, deadline);
      if (parent === null) break;
      root = parent;
    }
    return root === sessionId ? { sessionId } : { sessionId: root, agentId: sessionId };
  };

  const registerOnce = async (
    consumer: OcConsumer,
    message: { id: string; sessionID: string },
    parts: unknown[],
    deadline: Deadline,
  ): Promise<void> => {
    const answer = await ask("register", { consumer }, deadline);
    // A miss leaves the consumer unregistered, so the next message tries again.
    if (answer === null || disposed) return;
    registered.set(keyOf(consumer), consumer);
    if (answer.header === null) return;
    parts.push({
      id: partId(),
      sessionID: message.sessionID,
      messageID: message.id,
      type: "text",
      text: answer.header,
      synthetic: true,
    } satisfies OcTextPart);
  };

  return {
    async event({ event }) {
      try {
        const info = event.properties.info;
        if (disposed || info === undefined) return;
        const deadline = deadlineIn(EVENT_DEADLINE_MS);
        if (event.type === "session.created") {
          parents.set(info.id, info.parentID ?? null);
        } else if (event.type === "session.deleted") {
          parents.set(info.id, info.parentID ?? null);
          const consumer = await consumerOf(info.id, deadline);
          parents.delete(info.id);
          for (const [key, c] of registered) {
            if (
              key === keyOf(consumer) ||
              (consumer.agentId === undefined && c.sessionId === info.id)
            )
              registered.delete(key);
          }
          if (consumer.agentId === undefined) {
            await ask("end", { sessions: [info.id], consumers: [] }, deadline);
          } else {
            await ask("end", { sessions: [], consumers: [consumer] }, deadline);
          }
        }
      } catch {
        // D4: silence.
      }
    },

    async "chat.message"(input, output) {
      try {
        if (disposed) return;
        const deadline = deadlineIn(EVENT_DEADLINE_MS);
        const consumer = await consumerOf(input.sessionID, deadline);
        const key = keyOf(consumer);
        if (registered.has(key)) return;
        const inFlight = registering.get(key);
        if (inFlight !== undefined) {
          await within(inFlight, deadline());
          return;
        }
        const registration = registerOnce(consumer, output.message, output.parts, deadline);
        registering.set(key, registration);
        try {
          await registration;
        } finally {
          registering.delete(key);
        }
      } catch {
        // D4: silence.
      }
    },

    async "shell.env"(input, output) {
      try {
        const path = output.env.PATH ?? env.PATH;
        output.env.PATH =
          path === undefined || path === "" ? options.bin : `${options.bin}${delimiter}${path}`;
        if (input.sessionID === undefined) return;
        const consumer = await consumerOf(input.sessionID, deadlineIn(EVENT_DEADLINE_MS));
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
        const consumers = [...registered.values()];
        registered.clear();
        if (consumers.length === 0) return;
        await ask("end", { sessions: [], consumers }, deadlineIn(DISPOSE_DEADLINE_MS));
      } catch {
        // Silence; a consumer left registered ends with OpenCode's process (001 D10).
      }
    },
  };
}
