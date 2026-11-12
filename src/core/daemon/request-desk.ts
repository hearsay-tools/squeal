import { randomUUID } from "node:crypto";
import { PAYLOAD_SCHEMA_VERSION, type WorktreeId } from "../types/common.js";
import type { DaemonErrorResponse, DaemonPhase } from "../types/daemon.js";
import type { FailedOutcome } from "../types/daemon-writes.js";
import { errorResponse } from "./protocol.js";

/** Outcomes remembered for status requests, per desk; older ones are dropped. */
const REMEMBERED = 16;

/** A request a desk takes: for one worktree's daemon, read at one store schema. */
export interface DeskRequest {
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
}

/** A taken request's state: `outcome` `null` while the main thread runs it. */
export interface OutcomeAnswer<T extends string, O> {
  readonly schemaVersion: typeof PAYLOAD_SCHEMA_VERSION;
  readonly ok: true;
  readonly type: T;
  readonly requestId: string;
  readonly outcome: O | FailedOutcome | null;
}

export interface RequestDeskContext<R extends DeskRequest, O> {
  /** The answers' `type`: the request's own. */
  readonly type: string;
  readonly worktreeId: WorktreeId;
  /** `user_version` of the daemon's store; a request read at another one is refused. */
  readonly storeSchema: number;
  /** Runs one request on the main thread, which owns the stores. */
  readonly run: (request: R) => Promise<O>;
}

/**
 * Spec 021 D15 (row 021-20): the socket's side of a request the main
 * thread runs in the daemon's retried path, `squeal import`'s import and
 * the code gate's kept files. It hands each request to the main thread
 * and keeps its outcome in memory for the client's status requests, as
 * the write desk keeps a write's. Every refusal is an error answer, so
 * the client does as it does with no daemon; a run that rejects ends
 * `failed`.
 */
export class RequestDesk<T extends string, R extends DeskRequest, O> {
  readonly #context: RequestDeskContext<R, O> & { readonly type: T };
  readonly #states = new Map<string, { outcome: O | FailedOutcome | null }>();

  constructor(context: RequestDeskContext<R, O> & { readonly type: T }) {
    this.#context = context;
  }

  /** Takes `request`, unless it names another worktree or store schema, or the daemon stops. */
  take(request: R, phase: DaemonPhase): OutcomeAnswer<T, O> | DaemonErrorResponse {
    const { worktreeId, storeSchema } = this.#context;
    if (phase === "stopping") return errorResponse("daemon is stopping");
    if (request.worktreeId !== worktreeId) {
      return errorResponse(`this daemon serves worktree ${worktreeId}, not ${request.worktreeId}`);
    }
    if (request.storeSchema !== storeSchema) {
      return errorResponse(
        `the daemon's store is at schema ${storeSchema}, not ${request.storeSchema}`,
      );
    }
    const requestId = randomUUID();
    const state: { outcome: O | FailedOutcome | null } = { outcome: null };
    this.#states.set(requestId, state);
    for (const old of this.#states.keys()) {
      if (this.#states.size <= REMEMBERED) break;
      this.#states.delete(old);
    }
    this.#context.run(request).then(
      (outcome) => {
        state.outcome = outcome;
      },
      (error: unknown) => {
        state.outcome = { failed: error instanceof Error ? error.message : String(error) };
      },
    );
    return this.#answer(requestId, state.outcome);
  }

  /** How request `requestId` goes. */
  status(requestId: string): OutcomeAnswer<T, O> | DaemonErrorResponse {
    const state = this.#states.get(requestId);
    if (state === undefined) return errorResponse(`unknown request id ${requestId}`);
    return this.#answer(requestId, state.outcome);
  }

  #answer(requestId: string, outcome: O | FailedOutcome | null): OutcomeAnswer<T, O> {
    const { type } = this.#context;
    return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type, requestId, outcome };
  }
}
