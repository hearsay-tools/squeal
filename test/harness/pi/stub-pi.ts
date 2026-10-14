import type {
  PiApi,
  PiContext,
  PiCustomMessage,
  SessionShutdownEvent,
  SessionStartEvent,
} from "../../../src/harness/pi/api.js";

/** A Pi API stand-in: records the handlers an extension registers and the messages it sends. */
export interface StubPi {
  readonly api: PiApi;
  readonly sent: { message: PiCustomMessage; options: unknown }[];
  start(reason: SessionStartEvent["reason"], ctx: PiContext): Promise<void>;
  shutdown(reason: SessionShutdownEvent["reason"], ctx: PiContext): Promise<void>;
  /** Fires `type` with `event`'s fields and resolves what the handler returned. */
  fire(type: string, event: object, ctx: PiContext): Promise<unknown>;
}

export function stubPi(): StubPi {
  const handlers = new Map<string, (event: unknown, ctx: PiContext) => unknown>();
  const sent: StubPi["sent"] = [];
  const api = {
    on(event: string, handler: (event: unknown, ctx: PiContext) => unknown) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    sendMessage(message: PiCustomMessage, options?: unknown) {
      sent.push({ message, options });
    },
  } as unknown as PiApi;
  const fire = async (type: string, event: object, ctx: PiContext) =>
    handlers.get(type)?.({ type, ...event }, ctx);
  return {
    api,
    sent,
    fire,
    start: async (reason, ctx) => {
      await fire("session_start", { reason }, ctx);
    },
    shutdown: async (reason, ctx) => {
      await fire("session_shutdown", { reason }, ctx);
    },
  };
}

/** A handler context whose session id is `getSessionId()`'s, in `cwd`, in Pi's `mode`. */
export function piContext(
  sessionId: string | (() => string),
  cwd = "/",
  mode: PiContext["mode"] = "print",
): PiContext {
  const getSessionId = typeof sessionId === "string" ? () => sessionId : sessionId;
  return { mode, cwd, sessionManager: { getSessionId } } as unknown as PiContext;
}
