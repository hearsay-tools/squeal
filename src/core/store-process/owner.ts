import type { Statement } from "../daemon/write-batch.js";
import { busyBackoffMs } from "../store/busy.js";
import { isBusy } from "../store/connection.js";
import type { WriteKind } from "./queue.js";
import type { FallbackReason } from "./relay-counts.js";

/*
 * Spec 021 D22.4 as amended 2026-11-19 (row 021-36, after two failing
 * reviews of 0.1.571): one owner per batch. The daemon's relay thread owns
 * each batch from send until it is written exactly once, in its worktree's
 * order. It writes a batch here only when the store process's lock file is
 * free, which proves no store process can still write it, or when the store
 * process refused it before taking it. It never writes here because a batch
 * is slow. A store process that holds its lock but answers no ping within
 * `hungMs` is ended (`SIGKILL`; SQLite rolls its open transaction back), and
 * once its lock is free the batch is written here, under its mark (D22.4),
 * which tells whether that process committed it first. A batch is failed
 * only when nobody can write it any more, so its caller's retry is the only
 * copy that can land.
 */

/** One batch to settle, as the main thread hands it over. */
export interface OwnedJob {
  readonly n: number;
  readonly seq: string;
  readonly kind: WriteKind;
  readonly splittable: boolean;
  readonly statements: readonly Statement[];
  /** The connection that wrote it, and that connection's epoch: a failure fails the rest of its epoch. */
  readonly conn: number;
  readonly epoch: number;
}

/**
 * How a batch ended: written by the store process (its answer, or its mark
 * found here: `marked`), written here and why, or written nowhere and
 * never to be (`busy` when SQLite's lock was the cause).
 */
export type Settled =
  | { readonly by: "store"; readonly marked: boolean }
  | { readonly by: "here"; readonly why: FallbackReason }
  | { readonly failed: string; readonly busy: boolean };

/** The store process as the owner sees it: a pid and when it started, which tell one instance from the next. */
export interface Instance {
  readonly pid: number;
  readonly startedAt: number;
}

/** A sent batch's state at the store process: `written` `null` while it waits. */
export interface WriteState {
  readonly written: boolean | null;
  readonly error: string | null;
}

/** What the owner does to the world; the relay thread's real ones, a test's fakes. */
export interface OwnerPorts {
  /** Whether the store process's lock file is free now: no store process lives. */
  lockFree(): boolean;
  /** Starts a store process; the caller limits how often. */
  start(): void;
  /** The store process's answer to a ping; `null` with none in time. */
  ping(): Promise<Instance | null>;
  /** Sends the batch: its request id and first state, a refusal, or `lost` (no answer: it may have been taken). */
  submit(
    job: OwnedJob,
  ): Promise<
    { readonly id: string; readonly state: WriteState } | { readonly refused: string } | "lost"
  >;
  /** The sent batch's state; `unknown` when the store process does not know the id, `lost` with no answer. */
  status(id: string): Promise<WriteState | "unknown" | "lost">;
  /** The pid that holds the store process's lock, when it is a store process; `null` when not known. */
  holder(): number | null;
  kill(pid: number): void;
  /** Writes the batch here under its mark, waiting at most `busyMs` for SQLite's lock; throws as SQLite does. */
  direct(job: OwnedJob, busyMs: number): "written" | "superseded";
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface OwnerTiming {
  /** How long a store process that holds its lock may answer nothing before it is ended. */
  readonly hungMs: number;
  /** D1's bound: how long a batch busy at SQLite's lock is tried before it fails. */
  readonly boundMs: number;
  /** After a refused schema, how long batches are written here without asking. */
  readonly pauseMs: number;
  /** After a start that did not serve, how long until the next start. */
  readonly startEveryMs: number;
}

export const OWNER_TIMING: OwnerTiming = {
  hungMs: 10_000,
  boundMs: 10_000,
  pauseMs: 30_000,
  startEveryMs: 30_000,
};

/** D2: each direct try waits this long for SQLite's lock at most. */
const SLICE_MS = 250;
/** Between two reads of a sent batch's state, and between two pings of a silent process. */
const POLL_MS = [5, 10, 20, 50, 100] as const;
/** How long a killed store process may take to free its lock. */
const KILLED_MS = 5_000;

/** Where a batch stands while it is settled. */
type Step =
  | { readonly at: "send" }
  | { readonly at: "wait"; readonly id: string; readonly state: WriteState }
  | { readonly at: "probe"; readonly id: string | null };

export class BatchOwner {
  readonly #ports: OwnerPorts;
  readonly #timing: OwnerTiming;
  /** The store process last answering, so a new one is told from it. */
  #instance: Instance | null = null;
  #refusedUntil = Number.NEGATIVE_INFINITY;
  #startedAt = Number.NEGATIVE_INFINITY;
  /** Per connection, the last epoch a batch of it failed in. */
  readonly #failedEpoch = new Map<number, { readonly epoch: number; readonly settled: Settled }>();

  constructor(ports: OwnerPorts, timing: OwnerTiming = OWNER_TIMING) {
    this.#ports = ports;
    this.#timing = timing;
  }

  /**
   * Settles `job`, once. A batch of a connection whose earlier batch failed
   * in the same epoch fails as well, unwritten: it was decided on rows that
   * failed write left out.
   */
  async settle(job: OwnedJob): Promise<Settled> {
    const failed = this.#failedEpoch.get(job.conn);
    if (failed !== undefined && failed.epoch >= job.epoch) return failed.settled;
    const settled = await this.#settle(job);
    if ("failed" in settled) this.#failedEpoch.set(job.conn, { epoch: job.epoch, settled });
    return settled;
  }

  async #settle(job: OwnedJob): Promise<Settled> {
    const ports = this.#ports;
    const began = ports.now();
    /** Why the batch would be written here: no process had it, it was refused, or it was lost there. */
    let why: FallbackReason = "none";
    let silentSince: number | null = null;
    let step: Step = { at: "send" };
    for (let poll = 0; ; ) {
      if (step.at === "send") {
        if (ports.lockFree()) {
          if (why === "none") this.#start();
          return this.#direct(job, why);
        }
        if (ports.now() < this.#refusedUntil) return this.#direct(job, "refused");
        const sent = this.#instance === null ? "lost" : await ports.submit(job);
        if (sent === "lost") {
          step = { at: "probe", id: null };
          if (this.#instance !== null) why = "lost";
          continue;
        }
        if ("refused" in sent) {
          if (stopping(sent.refused)) {
            // It takes nothing more and frees its lock soon: the batch goes to the next one, or here.
            why = "refused";
            await ports.sleep(POLL_MS[POLL_MS.length - 1] as number);
            continue;
          }
          this.#refusedUntil = ports.now() + this.#timing.pauseMs;
          return this.#direct(job, "refused");
        }
        why = "lost";
        poll = 0;
        step = { at: "wait", id: sent.id, state: sent.state };
        continue;
      }
      if (step.at === "wait") {
        const { written, error } = step.state;
        if (written === true) return { by: "store", marked: false };
        if (written === false) {
          const next = this.#afterFailure(error ?? "failed", began);
          if (next !== null) return next;
          why = stopping(error ?? "") ? "refused" : "lost";
          await ports.sleep(busyBackoffMs(poll++));
          step = { at: "send" };
          continue;
        }
        const id: string = step.id;
        await ports.sleep(pollMs(poll++));
        const state = await ports.status(id);
        if (state === "lost") step = { at: "probe", id };
        else if (state === "unknown") step = { at: "send" };
        else step = { at: "wait", id, state };
        continue;
      }
      // Probe: no answer came. Gone, alive, or silent past `hungMs`.
      if (ports.lockFree()) {
        step = { at: "send" };
        continue;
      }
      const answer = await ports.ping();
      if (answer !== null) {
        silentSince = null;
        const same = this.#instance !== null && sameInstance(this.#instance, answer);
        this.#instance = answer;
        // The same process lives: ask again. Another one: the batch is sent to it (the mark keeps it once).
        step =
          same && step.id !== null ? { at: "wait", id: step.id, state: WAITING } : { at: "send" };
        continue;
      }
      const now = ports.now();
      silentSince ??= now;
      if (now - silentSince >= this.#timing.hungMs) {
        if (await this.#end()) why = "hung";
        silentSince = null;
        step = { at: "send" };
        continue;
      }
      await ports.sleep(pollMs(poll++));
    }
  }

  /** `null`: try the batch again; else how it ended. A busy failure is tried again within D1's bound. */
  #afterFailure(error: string, began: number): Settled | null {
    if (stopping(error)) return null;
    if (!busyText(error)) return { failed: error, busy: false };
    if (this.#ports.now() - began >= this.#timing.boundMs) return { failed: error, busy: true };
    return null;
  }

  /** Ends a store process that holds its lock and answers nothing, and waits for its lock to be free. */
  async #end(): Promise<boolean> {
    const ports = this.#ports;
    const pid = this.#instance?.pid ?? ports.holder();
    // With no pid known, nothing is ended: the batch waits, never written twice.
    if (pid === null) return false;
    ports.kill(pid);
    const deadline = ports.now() + KILLED_MS;
    for (let poll = 0; !ports.lockFree() && ports.now() < deadline; poll++) {
      await ports.sleep(pollMs(poll));
    }
    this.#instance = null;
    return true;
  }

  #start(): void {
    const now = this.#ports.now();
    if (now - this.#startedAt < this.#timing.startEveryMs) return;
    this.#startedAt = now;
    this.#instance = null;
    this.#ports.start();
  }

  /** D1, D2: written here in slices, tried again while busy, failed busy past the bound. */
  async #direct(job: OwnedJob, why: FallbackReason): Promise<Settled> {
    const ports = this.#ports;
    const began = ports.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const end = ports.direct(job, SLICE_MS);
        return end === "superseded" ? { by: "store", marked: true } : { by: "here", why };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!isBusy(error)) return { failed: text, busy: false };
        if (ports.now() - began >= this.#timing.boundMs) return { failed: text, busy: true };
      }
      await ports.sleep(busyBackoffMs(attempt));
    }
  }
}

const WAITING: WriteState = { written: null, error: null };

function pollMs(poll: number): number {
  return POLL_MS[Math.min(poll, POLL_MS.length - 1)] as number;
}

function sameInstance(a: Instance, b: Instance): boolean {
  return a.pid === b.pid && a.startedAt === b.startedAt;
}

/** The store process refused or dropped the batch as it stops. */
function stopping(error: string): boolean {
  return /stopping/.test(error);
}

/** SQLite's busy or locked error, as the store process reports it in text. */
function busyText(error: string): boolean {
  return /database is (locked|busy)|SQLITE_BUSY/i.test(error);
}
