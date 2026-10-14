/*
 * The part of OpenCode 1.18.35's plugin API Squeal uses, copied from
 * `@opencode-ai/plugin` 1.18.35 (`dist/index.d.ts`) and the SDK it names, as
 * spec 008 D6 allows: a local copy keeps the types beside the code that
 * relies on them and adds no dependency. Types only: the plugin bundle
 * imports nothing from OpenCode at run time.
 */

/** `Session` (SDK): the fields Squeal reads. */
export interface OcSessionInfo {
  readonly id: string;
  readonly parentID?: string;
}

/** The SDK's request result shape (`RequestResult`, "fields"): it does not throw on an HTTP error. */
export interface OcResult<T> {
  readonly data?: T;
  readonly error?: unknown;
}

/** `PluginInput.client`, the methods Squeal calls. */
export interface OcClient {
  readonly session: {
    get(options: { path: { id: string } }): Promise<OcResult<OcSessionInfo>>;
  };
  readonly app: {
    log(options: {
      body: { service: string; level: "debug" | "info" | "error" | "warn"; message: string };
    }): Promise<unknown>;
  };
}

/** `PluginInput`, the fields Squeal reads. */
export interface OcPluginInput {
  readonly client: OcClient;
  readonly directory: string;
  readonly worktree: string;
}

/** A bus event (`Event`): `session.created`, `session.deleted` and the rest. */
export interface OcEvent {
  readonly type: string;
  readonly properties: { readonly info?: OcSessionInfo; readonly sessionID?: string };
}

/** `TextPart` (SDK), as a plugin adds one to a user message. */
export interface OcTextPart {
  readonly id: string;
  readonly sessionID: string;
  readonly messageID: string;
  readonly type: "text";
  readonly text: string;
  readonly synthetic?: boolean;
}

/** `Hooks`, the ones Squeal returns. */
export interface OcHooks {
  dispose?: () => Promise<void>;
  event?: (input: { event: OcEvent }) => Promise<void>;
  "chat.message"?: (
    input: { sessionID: string; agent?: string; messageID?: string },
    output: { message: { id: string; sessionID: string }; parts: unknown[] },
  ) => Promise<void>;
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>;
}

/** `Plugin`. */
export type OcPlugin = (input: OcPluginInput) => Promise<OcHooks>;

/** `PluginModule`: what `exports["./server"]` default-exports (research, sessions 4). */
export interface OcPluginModule {
  readonly id: string;
  readonly server: OcPlugin;
}
