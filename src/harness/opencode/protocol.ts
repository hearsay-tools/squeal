/*
 * What the OpenCode plugin and its bridge say to each other (spec 008 D4):
 * one JSON request on the bridge's stdin, one `{"answer": ...}` on its
 * stdout. Types only: the plugin bundle imports nothing at run time from here.
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

export type OcRequest =
  /** `chat.message` on a consumer this instance has not registered (D3): ensure the daemon, register. */
  | ({ readonly kind: "register"; readonly consumer: OcConsumer } & OcHost)
  /**
   * `session.deleted` and `dispose` (D3): end each of `sessions`, its main
   * agent and every child, then unregister each of `consumers`.
   */
  | ({
      readonly kind: "end";
      readonly sessions: readonly string[];
      readonly consumers: readonly OcConsumer[];
    } & OcHost)
  /** The bare round trip, for the per-call cost (D4). */
  | ({ readonly kind: "ping" } & OcHost);

/** `register`'s answer: the registration header to put in the message, or `null`. */
export interface RegisterAnswer {
  readonly header: string | null;
}

/** The answer to each request kind. Every answer is an object, so `null` is only a miss. */
export interface OcAnswers {
  readonly register: RegisterAnswer;
  readonly end: { readonly ended: number };
  readonly ping: { readonly pong: true };
}

export type OcAnswer = OcAnswers[OcRequest["kind"]];
