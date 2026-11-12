import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../daemon/client.js";
import { leaseProcess } from "../daemon/lease-process.js";
import { encodeBatch, type Statement } from "../daemon/write-batch.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { DaemonRequest, DaemonResponse } from "../types/daemon.js";
import type { LeaseProcess, LeaseResponse, WriteResponse } from "../types/daemon-writes.js";
import type { SendOutcome, WriteSender } from "./sending-connection.js";

export interface DaemonWriterOptions {
  readonly worktreeId: WorktreeId;
  /** `user_version` of the client's store, which the daemon's must match. */
  readonly storeSchema: number;
  /** The serving daemon's socket, read once at the first lease; `null`: no daemon recorded. */
  readonly socketPath: () => AbsolutePath | null;
  /** Who asks, as the daemon names a lease's holder: a pid and a command. */
  readonly holder: string;
  /** How long a lease waits for another holder, and a write for its answer. */
  readonly boundMs: number;
  /** Each socket request's own bound. Default `REQUEST_TIMEOUT_MS`. */
  readonly requestTimeoutMs?: number;
}

/**
 * Each socket request's bound: a batch of thousands of statements is parsed
 * in the daemon's socket worker before it answers, so more than the hooks'
 * 100 ms liveness budget.
 */
export const REQUEST_TIMEOUT_MS = 1_000;

/**
 * A lease, release or status request's bound: answered from the socket
 * worker's memory, as a ping is, with room for a loaded host.
 */
export const SMALL_REQUEST_TIMEOUT_MS = 250;

const LEASE_PAUSES_MS = [2, 5, 10, 20, 40, 50] as const;
const STATUS_PAUSES_MS = [1, 2, 5, 10, 20, 25] as const;

/**
 * Spec 021 D15 (row 021-16): the client side of the writes a hook or a
 * command sends to the daemon that serves its worktree. `acquire` takes
 * the worktree's write lease, `send` hands a batch to the daemon and waits
 * until it is written, `release` ends the lease. When no daemon takes
 * writes (none recorded, none listening, one before these requests, a
 * stopping one, another store schema), `acquire` says so and `send`
 * answers `not-taken`, so the client writes the store itself.
 */
export class DaemonWriter implements WriteSender {
  readonly #options: DaemonWriterOptions;
  #socket: AbsolutePath | null | undefined;
  #token: string | null = null;
  #process: LeaseProcess | undefined;
  /** No daemon takes writes: every later call says so at once. */
  #off = false;

  constructor(options: DaemonWriterOptions) {
    this.#options = options;
  }

  get leased(): boolean {
    return this.#token !== null;
  }

  /**
   * Takes the worktree's write lease; `false` when no daemon takes writes.
   * Another holder is waited for until the bound, then a busy error is
   * thrown, as SQLite's busy timeout throws one (`isBusy` reads it).
   */
  async acquire(): Promise<boolean> {
    if (this.#token !== null) return true;
    const socket = this.#socketPath();
    if (socket === null) return false;
    const deadline = Date.now() + this.#options.boundMs;
    for (let attempt = 0; ; attempt++) {
      const { worktreeId, holder } = this.#options;
      // Review 0.1.442 B3: the lease lasts while this process lives, paused or not.
      this.#process ??= leaseProcess();
      const process = this.#process;
      const answer = await this.#ask(socket, { type: "lease", worktreeId, holder, process });
      if (!isLease(answer)) return this.#notTaken(false);
      if (answer.token !== null) {
        this.#token = answer.token;
        return true;
      }
      const pause = pauseOf(LEASE_PAUSES_MS, attempt);
      if (Date.now() + pause >= deadline) throw leaseBusy(answer.holder);
      await sleep(pause);
    }
  }

  async send(batch: readonly Statement[], release: boolean): Promise<SendOutcome> {
    const socket = this.#socketPath();
    if (socket === null) return "not-taken";
    const token = this.#token;
    if (release) this.#token = null;
    const request = {
      type: "write",
      worktreeId: this.#options.worktreeId,
      storeSchema: this.#options.storeSchema,
      token,
      release,
      batch: encodeBatch(batch),
    } as const;
    const answer = await this.#ask(socket, request);
    if (!isWrite(answer)) return this.#notTaken("not-taken", socket, token);
    const deadline = Date.now() + this.#options.boundMs;
    let state = answer;
    for (let attempt = 0; state.written === null; attempt++) {
      const pause = pauseOf(STATUS_PAUSES_MS, attempt);
      if (Date.now() + pause >= deadline) throw writeBusy();
      await sleep(pause);
      const next = await requestDaemon(
        socket,
        { type: "write-status", requestId: answer.requestId },
        SMALL_REQUEST_TIMEOUT_MS,
      );
      if (!isWrite(next)) throw new Error(`squeal: ${errorOf(next)}`);
      state = next;
    }
    if (state.written) return "written";
    // The daemon rolled it back: written here instead, where a failure surfaces as it would have.
    return this.#notTaken("not-taken", socket, release ? null : token);
  }

  async release(): Promise<void> {
    const token = this.#token;
    const socket = this.#socket;
    this.#token = null;
    if (token === null || socket === null || socket === undefined) return;
    const { worktreeId } = this.#options;
    await this.#ask(socket, { type: "release", worktreeId, token });
  }

  #socketPath(): AbsolutePath | null {
    if (this.#off) return null;
    if (this.#socket === undefined) this.#socket = this.#options.socketPath();
    return this.#socket;
  }

  /**
   * The daemon's answer; `null` when it took nothing: nothing listens
   * there, or, for any request but a write, it gave no answer (a hung
   * socket, or one that is not a daemon's): a lease or a release changes
   * no row, so the client writes the store itself. A write left unanswered
   * may have been taken, so it throws: never written twice.
   */
  async #ask(socket: AbsolutePath, request: DaemonRequest): Promise<DaemonResponse | null> {
    try {
      const timeout = request.type === "write" ? this.#timeout() : SMALL_REQUEST_TIMEOUT_MS;
      return await requestDaemon(socket, request, timeout);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ESTALE") return null;
      if (request.type !== "write") return null;
      throw error;
    }
  }

  /**
   * No daemon takes this client's writes from now on. A lease it still
   * holds there (`token`) is ended first: its process lives on, and would
   * keep it (review 0.1.442 B3).
   */
  async #notTaken<T>(answer: T, socket?: AbsolutePath, token?: string | null): Promise<T> {
    this.#off = true;
    this.#token = null;
    if (socket !== undefined && token !== undefined && token !== null) {
      const { worktreeId } = this.#options;
      await this.#ask(socket, { type: "release", worktreeId, token }).catch(() => null);
    }
    return answer;
  }

  #timeout(): number {
    return this.#options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }
}

/** A lease answer as this client reads it; another shape is no daemon that takes writes. */
function isLease(answer: DaemonResponse | null): answer is LeaseResponse {
  if (answer === null || !answer.ok || answer.type !== "lease") return false;
  const { token, holder } = answer as Partial<LeaseResponse>;
  return (token === null || typeof token === "string") && holder !== undefined;
}

function isWrite(answer: DaemonResponse | null): answer is WriteResponse {
  if (answer === null || !answer.ok || answer.type !== "write") return false;
  const { requestId, written } = answer as Partial<WriteResponse>;
  return typeof requestId === "string" && (written === null || typeof written === "boolean");
}

function pauseOf(pauses: readonly number[], attempt: number): number {
  return pauses[Math.min(attempt, pauses.length - 1)] ?? 0;
}

function errorOf(response: DaemonResponse): string {
  return response.ok ? `unexpected answer ${response.type}` : response.error;
}

/** SQLITE_BUSY, as `isBusy` reads it: the hook's paths for a locked store apply. */
function busy(message: string): Error {
  return Object.assign(new Error(`database is locked: ${message}`), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5,
  });
}

function leaseBusy(holder: string | null): Error {
  const error = busy(`the worktree's write lease is held${holder === null ? "" : ` by ${holder}`}`);
  return Object.assign(error, { leaseHolder: holder });
}

/** The lease's holder a busy error names (`acquire`); `null` when it names none. */
export function leaseHolderOf(error: unknown): string | null {
  const holder = (error as { leaseHolder?: unknown } | null)?.leaseHolder;
  return typeof holder === "string" ? holder : null;
}

function writeBusy(): Error {
  return busy("the daemon has not written this batch yet");
}
