import { randomUUID } from "node:crypto";
import { PAYLOAD_SCHEMA_VERSION, type WorktreeId } from "../types/common.js";
import type { DaemonErrorResponse, DaemonPhase } from "../types/daemon.js";
import type {
  LeaseProcess,
  LeaseRequest,
  LeaseResponse,
  ReleaseRequest,
  ReleaseResponse,
  SentBatch,
  WriteRequest,
  WriteResponse,
  WriteStatusRequest,
} from "../types/daemon-writes.js";
import { leaseProcessAlive } from "./lease-process.js";
import { errorResponse } from "./protocol.js";
import type { WriteRequests } from "./write-protocol.js";

/**
 * How long a lease lasts without a write under its token before the desk
 * asks whether its process still lives (review 0.1.442 B3): longer than a
 * hook's hand-off bound (2 s), and short enough that a client killed with
 * it costs the next one a few seconds at most. A lease whose process lives
 * is kept past it, so a client paused before its hand-off keeps its report
 * its own; one whose process cannot be told (no process named, another PID
 * namespace) ends at it.
 */
export const LEASE_TTL_MS = 5_000;

const STOPPING = "daemon is stopping";

/** What the desk answers. */
export type WriteAnswer = LeaseResponse | ReleaseResponse | WriteResponse | DaemonErrorResponse;

/** Write states and issued tokens remembered for status requests and late writes; older ones are dropped. */
const REMEMBERED = 64;

export interface WriteDeskContext {
  readonly worktreeId: WorktreeId;
  /** `user_version` of the daemon's store; a batch read at another one is refused. */
  readonly storeSchema: number;
  /** Writes one batch in the daemon's retried path; rejects with why it was not written. */
  readonly requestWrite: (batch: SentBatch) => Promise<void>;
  /** Milliseconds that never go back and do not run while the host sleeps. Default `performance.now`. */
  readonly now?: () => number;
  /** Whether a lease's process lives (`leaseProcessAlive`); a test gives its own. */
  readonly alive?: (holder: LeaseProcess) => boolean | null;
}

interface Lease {
  readonly token: string;
  readonly holder: string;
  /** The client's process: the lease outlives its time while it lives. */
  readonly process: LeaseProcess | undefined;
  until: number;
  /** Writes under it not yet settled: it does not end while one waits on a busy store. */
  pending: number;
  /** A write asked to end it once settled. */
  releasing: boolean;
}

interface WriteState {
  written: boolean | null;
  error: string | null;
}

/**
 * Spec 021 D15 (row 021-16): the socket's side of the writes hooks and
 * commands send. It keeps the worktree's write lease and each write's
 * state in memory, as the other handlers do, and hands every batch to the
 * main thread, which owns the store. Every refusal is an error answer, so
 * the client writes the store itself.
 */
export class WriteDesk {
  readonly #context: WriteDeskContext;
  #lease: Lease | null = null;
  readonly #issued = new Set<string>();
  readonly #writes = new Map<string, WriteState>();

  constructor(context: WriteDeskContext) {
    this.#context = context;
  }

  /**
   * The answer to `request`. A stopping daemon takes no new lease or write:
   * its client writes itself, except while another client holds the lease,
   * whose report must stay its own (review 0.1.442 B3).
   */
  answer(request: WriteRequests, phase: DaemonPhase): WriteAnswer {
    switch (request.type) {
      case "lease": {
        if (phase !== "stopping") return this.lease(request);
        const current = this.#current();
        return current === null ? errorResponse(STOPPING) : this.#leaseAnswer(null, current.holder);
      }
      case "write":
        return phase === "stopping" ? errorResponse(STOPPING) : this.write(request);
      case "release":
        return this.release(request);
      case "write-status":
        return this.status(request);
    }
  }

  lease(request: LeaseRequest): LeaseResponse | DaemonErrorResponse {
    const other = this.#otherWorktree(request.worktreeId);
    if (other !== null) return other;
    const current = this.#current();
    if (current !== null) return this.#leaseAnswer(null, current.holder);
    const token = randomUUID();
    this.#lease = {
      token,
      holder: request.holder,
      process: request.process,
      until: this.#now() + LEASE_TTL_MS,
      pending: 0,
      releasing: false,
    };
    remember(this.#issued, token);
    return this.#leaseAnswer(token, null);
  }

  release(request: ReleaseRequest): ReleaseResponse | DaemonErrorResponse {
    const refused = this.#otherWorktree(request.worktreeId) ?? this.#unknownToken(request.token);
    if (refused !== null) return refused;
    const lease = this.#lease;
    if (lease?.token === request.token) {
      if (lease.pending > 0) lease.releasing = true;
      else this.#lease = null;
    }
    return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "release" };
  }

  write(request: WriteRequest): WriteResponse | DaemonErrorResponse {
    const refused =
      this.#otherWorktree(request.worktreeId) ??
      (request.token === null ? null : this.#unknownToken(request.token));
    if (refused !== null) return refused;
    if (request.storeSchema !== this.#context.storeSchema) {
      return errorResponse(
        `the daemon's store is at schema ${this.#context.storeSchema}, not ${request.storeSchema}`,
      );
    }
    // A write under a lease that ended is still written: its client told its host already.
    const lease = this.#lease?.token === request.token ? this.#lease : null;
    if (lease !== null) {
      lease.until = this.#now() + LEASE_TTL_MS;
      lease.pending++;
      if (request.release) lease.releasing = true;
    }
    const requestId = randomUUID();
    const state: WriteState = { written: null, error: null };
    this.#writes.set(requestId, state);
    for (const old of this.#writes.keys()) {
      if (this.#writes.size <= REMEMBERED) break;
      this.#writes.delete(old);
    }
    const settle = (error: string | null) => {
      state.written = error === null;
      state.error = error;
      if (lease === null) return;
      lease.pending--;
      lease.until = this.#now() + LEASE_TTL_MS;
      if (lease.releasing && lease.pending === 0 && this.#lease === lease) this.#lease = null;
    };
    this.#context.requestWrite(request.batch).then(
      () => settle(null),
      (error: unknown) => settle(error instanceof Error ? error.message : String(error)),
    );
    return writeAnswer(requestId, state);
  }

  status(request: WriteStatusRequest): WriteResponse | DaemonErrorResponse {
    const state = this.#writes.get(request.requestId);
    if (state === undefined) return errorResponse(`unknown request id ${request.requestId}`);
    return writeAnswer(request.requestId, state);
  }

  /**
   * The lease in force. One past its time with no write waiting is kept
   * while its process lives, for another `LEASE_TTL_MS`, and else has ended.
   */
  #current(): Lease | null {
    const lease = this.#lease;
    if (lease === null || lease.pending > 0 || this.#now() < lease.until) return lease;
    const alive = this.#context.alive ?? leaseProcessAlive;
    if (lease.process !== undefined && alive(lease.process) === true) {
      lease.until = this.#now() + LEASE_TTL_MS;
      return lease;
    }
    this.#lease = null;
    return null;
  }

  #otherWorktree(worktreeId: WorktreeId): DaemonErrorResponse | null {
    if (worktreeId === this.#context.worktreeId) return null;
    return errorResponse(
      `this daemon serves worktree ${this.#context.worktreeId}, not ${worktreeId}`,
    );
  }

  #unknownToken(token: string): DaemonErrorResponse | null {
    return this.#issued.has(token) ? null : errorResponse("unknown lease token");
  }

  #leaseAnswer(token: string | null, holder: string | null): LeaseResponse {
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "lease",
      token,
      ttlMs: LEASE_TTL_MS,
      holder,
    };
  }

  #now(): number {
    return (this.#context.now ?? (() => performance.now()))();
  }
}

function writeAnswer(requestId: string, state: WriteState): WriteResponse {
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "write",
    requestId,
    written: state.written,
    error: state.error,
  };
}

function remember(set: Set<string>, value: string): void {
  set.add(value);
  for (const old of set) {
    if (set.size <= REMEMBERED) break;
    set.delete(old);
  }
}
