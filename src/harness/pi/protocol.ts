/*
 * What the Pi extension's main thread and its delivery worker say to each
 * other (spec 009 D4): one request per handler, one answer per request, by id.
 */

/** `session_start.reason` in Pi 1.0.4 (`SessionStartEvent`). */
export type StartReason = "startup" | "reload" | "new" | "resume" | "fork";

/** The session a request is about (D2): its id and the cwd Pi runs in. */
export interface PiSession {
  readonly sessionId: string;
  readonly cwd: string;
}

export type PiRequest =
  /** `session_start` (D2, D3): ensure the daemon, register; the header to queue, or `null`. */
  | ({ readonly kind: "start"; readonly reason: StartReason } & PiSession)
  /** `session_shutdown` (D3): unregister the session's consumers; `null`. */
  | ({ readonly kind: "shutdown" } & PiSession)
  /**
   * A tool boundary (D3 `turn_end`): the undelivered delta as text, or `null`.
   * `edited` when a tool of the batch may have changed files.
   */
  | ({ readonly kind: "boundary"; readonly edited: boolean } & PiSession)
  /** `before_agent_start` (D3): the primer and the run's news. */
  | ({ readonly kind: "run" } & PiSession)
  /**
   * `tool_call` (D3) on `edit`, `write` and `bash`: the reason to block the
   * call, or `null`. `command` is a `bash` call's.
   */
  | ({
      readonly kind: "toolCall";
      readonly toolName: string;
      readonly command?: string;
    } & PiSession)
  /** `agent_before_settle` (D3, 002's Stop): what to continue the run with. */
  | ({ readonly kind: "settle" } & PiSession)
  /** `agent_settled` after a run no settle ended (D3, 002's Interrupt): `null`. */
  | ({ readonly kind: "endTurn" } & PiSession)
  /** The bare round trip, for the per-call cost (D4): `null`. */
  | { readonly kind: "ping" };

/** `run`'s answer: the system-prompt section, and the `startTurn` news as the run's message. */
export interface RunAnswer {
  readonly primer: string | null;
  readonly news: string | null;
}

/**
 * `settle`'s answer: the report to continue the run with, or `null` when
 * Stop was silent and ended the turn. A missed deadline is no answer at all,
 * so the turn is then still the `agent_settled` handler's to end.
 */
export interface SettleAnswer {
  readonly report: string | null;
}

/** The answer to each request kind. */
export interface PiAnswers {
  readonly start: string | null;
  readonly shutdown: null;
  readonly boundary: string | null;
  readonly run: RunAnswer;
  readonly toolCall: string | null;
  readonly settle: SettleAnswer;
  readonly endTurn: null;
  readonly ping: null;
}

export type PiAnswer = PiAnswers[PiRequest["kind"]];

/** A request as posted, with the id its answer carries. */
export interface ToWorker {
  readonly id: number;
  readonly request: PiRequest;
}

/** The answer: the handler's result, or `ok: false` when it threw. */
export type FromWorker =
  | { readonly id: number; readonly ok: true; readonly answer: PiAnswer }
  | { readonly id: number; readonly ok: false };
