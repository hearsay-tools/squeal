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
  /** A tool boundary (D3 `turn_end`): the undelivered delta as text, or `null`. */
  | ({ readonly kind: "boundary" } & PiSession)
  /** The bare round trip, for the per-call cost (D4): `null`. */
  | { readonly kind: "ping" };

/** A request as posted, with the id its answer carries. */
export interface ToWorker {
  readonly id: number;
  readonly request: PiRequest;
}

/** The answer: the handler's text, or `ok: false` when it threw. */
export type FromWorker =
  | { readonly id: number; readonly ok: true; readonly text: string | null }
  | { readonly id: number; readonly ok: false };
