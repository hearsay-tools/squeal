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
  } as PiApi;
  const fire = async (type: string, event: object, ctx: PiContext) => {
    await handlers.get(type)?.({ type, ...event }, ctx);
  };
  return {
    api,
    sent,
    start: (reason, ctx) => fire("session_start", { reason }, ctx),
    shutdown: (reason, ctx) => fire("session_shutdown", { reason }, ctx),
  };
}

/** A handler context for session `sessionId` in `cwd`. */
export function piContext(sessionId: string, cwd = "/"): PiContext {
  return { mode: "print", cwd, sessionManager: { getSessionId: () => sessionId } };
}
