/*
 * What the OpenCode plugin and its bridge say to each other (spec 008 D4):
 * one JSON request on the bridge's stdin, one `{"answer": ...}` on its
 * stdout. Each kind has its own bridge entry, `dist/hooks/<kind>.mjs`
 * (`bridgeFile`), which loads only its own handler. Types and that one
 * mapping only: the plugin bundle imports nothing else from here.
 */

/** A consumer (D2): a root session's `(sessionId, "main")`, a child's `(rootId, childId)`. */
export interface OcConsumer {
  /** The root session's id. */
  readonly sessionId: string;
  /** The child session's id; absent for the root session's main agent. */
  readonly agentId?: string;
}

/** What every request carries: the plugin's `worktree` input (D2) and OpenCode's pid. */
export interface OcHost {
  readonly worktree: string;
  /** `process.pid` in the plugin, OpenCode's process, equal to `OPENCODE_PID` (D2). */
  readonly pid: number;
}

/** A request about one consumer. */
type About<K extends string, T = object> = { readonly kind: K; readonly consumer: OcConsumer } & T &
  OcHost;

export type OcRequest =
  /** `chat.message` on a consumer this instance has not registered (D3): ensure the daemon, register. */
  | About<"register">
  /** `chat.message` on a registered consumer (D3): `startTurn`, the undelivered delta. */
  | About<"prompt">
  /**
   * `tool.execute.before` (D3): put an idle consumer back in a turn; the
   * regression deny on `edit`, `write` and `apply_patch`, 005 D8's on a
   * `bash` `command` run in `workdir`.
   */
  | About<"before", { readonly tool: string; readonly command?: string; readonly workdir?: string }>
  /** `tool.execute.after` (D3): the tool boundary's delta. */
  | About<"after", { readonly tool: string }>
  /** `session.idle` of a root session Squeal has not continued (D3, 002's Stop). */
  | About<"stop">
  /** `session.idle` after Squeal's continuation or an abort (D3): end the turn. */
  | About<"endTurn">
  /** The idle wake (D5): wait for the idle delta; no deadline but the waiter's own. */
  | About<"wait">
  /**
   * `session.deleted`, a child's `session.idle` and `dispose` (D3): end each
   * of `sessions`, its main agent and every child, then unregister each of
   * `consumers`.
   */
  | ({
      readonly kind: "end";
      readonly sessions: readonly string[];
      readonly consumers: readonly OcConsumer[];
    } & OcHost)
  /** The bare round trip, for the per-call cost (D4). */
  | ({ readonly kind: "ping" } & OcHost);

export type OcKind = OcRequest["kind"];

/**
 * `register`'s answer: the registration header to put in the message, or
 * `null`; whether a consumer row was written, without which the plugin asks
 * again at the next message (review 008-15); and the primer for the system
 * prompt, `null` without a store.
 */
export interface RegisterAnswer {
  readonly header: string | null;
  readonly registered: boolean;
  readonly primer: string | null;
}

/** The answer to each request kind. Every answer is an object, so `null` is only a miss. */
export interface OcAnswers {
  readonly register: RegisterAnswer;
  readonly prompt: { readonly text: string | null };
  /** The reason to block the call, or `null` to let it run. */
  readonly before: { readonly reason: string | null };
  readonly after: { readonly text: string | null };
  /** The report to continue the turn with, or `null` when Stop was silent and ended the turn. */
  readonly stop: { readonly report: string | null };
  readonly endTurn: { readonly ended: boolean };
  /** The idle delta to wake the agent with, or `null` at expiry, on a cancel or with no store. */
  readonly wait: { readonly text: string | null };
  readonly end: { readonly ended: number };
  readonly ping: { readonly pong: true };
}

export type OcAnswer = OcAnswers[OcKind];

/** The bridge entry of `kind` under `dist/hooks/`: `endTurn` is `end-turn.mjs`. */
export function bridgeFile(kind: OcKind): string {
  return `${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.mjs`;
}
