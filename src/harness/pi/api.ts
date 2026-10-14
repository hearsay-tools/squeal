import type {
  AgentBeforeSettleEvent,
  AgentSettledEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

/*
 * The part of Pi 1.0.4's extension API Squeal uses, from the pinned
 * devDependency `@earendil-works/pi-coding-agent`. Type imports only: the
 * bundle imports nothing from Pi at run time (spec 009 D1).
 */

export type {
  AgentBeforeSettleEvent,
  AgentSettledEvent,
  BeforeAgentStartEvent,
  InputEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  TurnEndEvent,
};

/** `ExtensionContext`, the fields Squeal reads. Any read throws once Pi marks the context stale. */
export type PiContext = Pick<ExtensionContext, "mode" | "cwd" | "sessionManager">;

/** `ExtensionAPI`, the methods Squeal calls. */
export type PiApi = Pick<ExtensionAPI, "on" | "sendMessage">;

/** What Squeal says to the model: a displayed custom message of its own type (D3). */
export interface PiCustomMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}
