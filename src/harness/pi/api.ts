import type { StartReason } from "./protocol.js";

/*
 * The part of Pi 1.0.4's extension API Squeal uses, structurally
 * (`@earendil-works/pi-coding-agent` `dist/core/extensions/types.d.ts`). The
 * bundle imports nothing from Pi at run time (spec 009 D1), so these types
 * stand alone; a Pi whose objects fit them works.
 */

export type PiMode = "tui" | "rpc" | "json" | "print";

/** `ExtensionContext`, the fields Squeal reads. Any read throws once Pi marks the context stale. */
export interface PiContext {
  readonly mode: PiMode;
  readonly cwd: string;
  readonly sessionManager: { getSessionId(): string };
}

export interface SessionStartEvent {
  readonly type: "session_start";
  readonly reason: StartReason;
  readonly previousSessionFile?: string;
}

export interface SessionShutdownEvent {
  readonly type: "session_shutdown";
  readonly reason: "quit" | "reload" | "new" | "resume" | "fork";
  readonly targetSessionFile?: string;
}

/** `Pick<CustomMessage, "customType" | "content" | "display">`. */
export interface PiCustomMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

export type PiHandler<E> = (event: E, ctx: PiContext) => Promise<void> | void;

/** `ExtensionAPI`, the methods Squeal calls. */
export interface PiApi {
  on(event: "session_start", handler: PiHandler<SessionStartEvent>): unknown;
  on(event: "session_shutdown", handler: PiHandler<SessionShutdownEvent>): unknown;
  sendMessage(
    message: PiCustomMessage,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): void;
}
