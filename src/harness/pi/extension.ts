import type { Worker } from "node:worker_threads";
import type { PiApi, PiContext } from "./api.js";
import { createDeliveryHost, type DeliveryHost } from "./host.js";
import type { PiSession } from "./protocol.js";

/** Spec 009 D4: the deadline of `session_start`, as `turn_end`, `tool_call` and `before_agent_start`. */
export const EVENT_DEADLINE_MS = 2_000;
/** D4: the deadline of `session_shutdown`. */
export const SHUTDOWN_DEADLINE_MS = 3_000;

/** D3: every entry Squeal adds is a displayed custom message of this type. */
export const CUSTOM_TYPE = "squeal";

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

/**
 * The Squeal extension factory on `start`, which creates the delivery worker
 * (spec 009 D3, D4). Pi calls the factory once per extension instance: at
 * load, and again in the same module after each session replacement or
 * reload, so everything here is per instance.
 *
 * - `session_start` starts the delivery host and registers once per session
 *   id (RPC delivers it twice per replacement, D2), then queues the header
 *   for the next prompt at no extra request.
 * - `session_shutdown` unregisters the outgoing session, except on `reload`,
 *   whose next instance takes it over, then stops the host. After it every
 *   event of the instance is silent.
 *
 * No handler throws or outlasts its deadline: a miss is silence (D4).
 */
export function squealExtension(start: () => Worker): (pi: PiApi) => void {
  return (pi) => {
    let host: DeliveryHost | null = null;
    let shutDown = false;
    const started = new Set<string>();

    pi.on("session_start", async (event, ctx) => {
      try {
        const session = sessionOf(ctx);
        if (shutDown || session === null || started.has(session.sessionId)) return;
        started.add(session.sessionId);
        host ??= createDeliveryHost(start);
        const text = await host.call(
          { kind: "start", reason: event.reason, ...session },
          EVENT_DEADLINE_MS,
        );
        if (text === null || shutDown) return;
        pi.sendMessage(
          { customType: CUSTOM_TYPE, content: text, display: true },
          { deliverAs: "nextTurn" },
        );
      } catch {
        // D4: silence; Pi would print a thrown error as an extension error.
      }
    });

    pi.on("session_shutdown", async (event, ctx) => {
      if (shutDown) return;
      shutDown = true;
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
