import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  MessageChannel,
  type MessagePort,
  receiveMessageOnPort,
  Worker,
} from "node:worker_threads";
import type { OpenCodeStoreOptions } from "../code/store/open.js";
import type { Statement } from "../daemon/write-batch.js";
import { SendingConnection, type WriteSender } from "../delivery/sending-connection.js";
import { busySliceMs, type Connection, isBusy } from "../store/connection.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import { batchSeq, GuardedWriter } from "./guard.js";
import { storeProcessSocketPath } from "./paths.js";
import type { WriteKind } from "./queue.js";
import { noFallback, type RelayCounts, reasonOf, reportLine, snapshotOf } from "./relay-counts.js";
import type { CancelState, RelayData, RelayJob, RelayOutcome } from "./relay-thread.js";
import type { StoreProcessLaunch } from "./spawn.js";

/*
 * Spec 021 D22 (row 021-36): a daemon's code-store writes go to the clone's
 * store process. Each connection the daemon opens is a `SendingConnection`
 * (D15's client) whose batches this relay sends, one at a time, from a
 * worker thread (`relay-thread.ts`). The daemon's main thread waits for each
 * batch's answer, so its callers read what they wrote, as today; it waits
 * at most the busy timeout a write here would have waited for the lock
 * (the coordinator's condition, 2026-11-19). A batch not taken, or not
 * answered in that bound, is written here under the batch's mark
 * (`GuardedWriter`), which settles it: written by the store process
 * already, or written now, never both. With no store process, the daemon
 * writes every batch here, as before.
 */

export interface CodeRelayOptions {
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The code store's schema this Squeal writes (`CODE_SCHEMA_VERSION`). */
  readonly storeSchema: number;
  /** How to start the store process; `null`: use one only when it serves. */
  readonly launch: StoreProcessLaunch | null;
  /** The relay thread's script and its Node options; default `relayScript()`. `null`: no relay. */
  readonly thread?: { readonly script: string; readonly execArgv?: readonly string[] } | null;
  readonly env?: NodeJS.ProcessEnv;
  /** D22.6: the daemon's log, where a line a minute says how its batches went. */
  readonly log?: (line: string) => void;
  /** How often that line is written, when a batch was written since the last. Default a minute. */
  readonly reportMs?: number;
}

interface KindNow {
  readonly kind: WriteKind;
  readonly splittable: boolean;
}

/** What a batch is for the store process's queue, set by the code that writes it (`withWriteKind`). */
const kinds = new AsyncLocalStorage<KindNow>();

/**
 * Runs `fn`, its awaited continuations included, with its batches queued
 * as `kind`; `splittable` ones may be written in slices, so their
 * statements must be ones that may run twice. Unset: `record`.
 */
export function withWriteKind<T>(kind: WriteKind, fn: () => T, splittable = false): T {
  return kinds.run({ kind, splittable }, fn);
}

/** The relay thread's script beside this module; `null` from the TypeScript sources. */
export function relayScript(
  module: URL = new URL(import.meta.url),
): { readonly script: string; readonly execArgv?: readonly string[] } | null {
  for (const name of ["./relay-thread.js", "./store-relay.mjs"]) {
    const script = fileURLToPath(new URL(name, module));
    if (existsSync(script)) return { script };
  }
  return null;
}

/** How long a batch given up on may take to settle before its caller is told it is unknown. */
const SETTLE_MS = 30_000;
/** How often a cancel the store process did not answer is sent again. */
const ASK_AGAIN_MS = 500;

/** SQLite's busy error, as `isBusy` reads it, so callers treat it as a busy store. */
function locked(message: string): Error {
  return Object.assign(new Error(`database is locked: ${message}`), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5,
  });
}

/** D22.6: how often the daemon logs its code-store batches. */
const REPORT_MS = 60_000;

export class CodeRelay {
  readonly counts: RelayCounts = {
    sent: 0,
    direct: 0,
    superseded: 0,
    late: 0,
    failed: 0,
    fallback: noFallback(),
  };
  /** The counts at the last line logged. */
  #reported = snapshotOf(this.counts);
  #reporter: NodeJS.Timeout | null = null;
  readonly #options: CodeRelayOptions;
  readonly #signal = new Int32Array(new SharedArrayBuffer(4));
  readonly #port: MessagePort | null = null;
  readonly #worker: Worker | null = null;
  readonly #start = Date.now();
  readonly #writers = new WeakMap<DatabaseSync, GuardedWriter>();
  #counter = 0;
  /** The batch the thread still sends, answered or not. */
  #inFlight: number | null = null;
  /** The thread's answers not yet taken: to sends, by batch, and to cancels, by batch. */
  readonly #answers = new Map<number, RelayOutcome>();
  readonly #cancels = new Map<number, CancelState>();
  /** Review of 0.1.571 B4: the thread ended (also before `close`, as at a failed start). */
  #exited = false;
  #exit: Promise<void> = Promise.resolve();
  /** A batch neither written nor withdrawn: its direct write failed, and the store process may still write it. */
  #pending: {
    readonly n: number;
    readonly seq: string;
    readonly batch: readonly Statement[];
  } | null = null;
  #closed = false;

  constructor(options: CodeRelayOptions) {
    this.#options = options;
    if (options.log !== undefined) {
      this.#reporter = setInterval(() => this.#report(), options.reportMs ?? REPORT_MS);
      this.#reporter.unref();
    }
    const thread = options.thread === undefined ? relayScript() : options.thread;
    if (thread === null) return;
    const { port1, port2 } = new MessageChannel();
    const data: RelayData = {
      commonDir: options.commonDir,
      worktreeId: options.worktreeId,
      storeSchema: options.storeSchema,
      socketPath: storeProcessSocketPath(options.commonDir, "code", options.env),
      launch: options.launch,
      env: { ...(options.env ?? process.env) },
      port: port2,
      signal: this.#signal.buffer as SharedArrayBuffer,
    };
    this.#worker = new Worker(thread.script, {
      workerData: data,
      transferList: [port2],
      ...(thread.execArgv === undefined ? {} : { execArgv: [...thread.execArgv] }),
    });
    this.#worker.on("error", () => {});
    this.#exit = new Promise<void>((resolve) => {
      this.#worker?.once("exit", () => {
        this.#exited = true;
        resolve();
      });
    });
    this.#worker.unref();
    this.#port = port1;
  }

  /**
   * Options for `openCodeStore`: its connection sends its writes through
   * this relay. With no relay thread (no script beside this module), none:
   * the store is written as before this row, with a plain `Connection`.
   */
  codeStoreOptions(): Pick<OpenCodeStoreOptions, "connection"> {
    return this.#port === null ? {} : { connection: (db) => this.connection(db) };
  }

  /** A connection over `db` whose writes go through this relay. */
  connection(db: DatabaseSync): Connection {
    const sender: WriteSender = {
      leased: true,
      send: async () => "not-taken",
      release: async () => {},
      sendNow: (batch) => this.#write(db, batch),
    };
    return new SendingConnection(db, sender);
  }

  /** Ends the thread; its lease at the store process ends with it. */
  async close(leaving = false): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#reporter !== null) clearInterval(this.#reporter);
    this.#report();
    const worker = this.#worker;
    if (worker === null || this.#exited) return;
    this.#port?.postMessage({ close: true, leaving });
    // Bounded: a thread that does not end in 1 s is terminated, and the close waits 1 s more at most.
    const timer = setTimeout(() => void worker.terminate(), 1_000);
    const cap = new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref());
    await Promise.race([this.#exit, cap]);
    clearTimeout(timer);
  }

  /** D22.6: the line of the batches since the last (`reportLine`), when there were any. */
  #report(): void {
    const line = reportLine(this.counts, this.#reported);
    this.#reported = snapshotOf(this.counts);
    if (line !== null) this.#options.log?.(line);
  }

  /**
   * Writes `batch`: through the store process when it answers within the
   * bound, else here. Review of 0.1.571: a batch not answered in time, or
   * lost, is settled first (`#settle`), and only then written here or
   * reported failed, so it is never written twice, never after a later
   * batch of its worktree, and never after its caller was told it failed.
   */
  #write(db: DatabaseSync, batch: readonly Statement[]): void {
    const n = ++this.#counter;
    const seq = batchSeq(this.#start, n);
    const bound = boundOf(db);
    const started = performance.now();
    const left = () => Math.round(Math.max(0, bound - (performance.now() - started)));
    if (!this.#settlePending(db, bound)) {
      this.counts.failed++;
      throw locked("an earlier code-store batch of this worktree is not settled yet");
    }
    let outcome = this.#send(n, seq, batch, bound);
    if (outcome === "written") {
      this.counts.sent++;
      return;
    }
    if (outcome === "late" || outcome === "unknown") {
      if (outcome === "late") this.counts.late++;
      const settled = this.#settle(db, n, seq, batch);
      if (settled === "written") return;
      if (settled === "unsettled") {
        this.counts.failed++;
        this.#pending = { n, seq, batch };
        throw locked("the store process neither wrote nor withdrew this code-store batch in time");
      }
      // Surely not written there: written here now, with no more wait.
      outcome = "late";
    }
    try {
      if (this.#direct(db, seq, batch, outcome === "late" ? 0 : left()) === "written") {
        this.counts.fallback[reasonOf(outcome)]++;
      }
    } catch (error) {
      this.counts.failed++;
      throw error;
    }
  }

  /**
   * Settles batch `n`, which its sender gave up on: withdrawn at the store
   * process (`cancelled`), or ended there (`written`, `failed`); one it
   * began is waited for. When the store process cannot say (gone, stopped,
   * the batch unknown there), it is written here under its mark, which the
   * store process honors. `unsettled` past `SETTLE_MS`.
   */
  #settle(
    db: DatabaseSync,
    n: number,
    seq: string,
    batch: readonly Statement[],
  ): "written" | "not-written" | "unsettled" {
    const deadline = performance.now() + SETTLE_MS;
    let askedAt = Number.NEGATIVE_INFINITY;
    for (;;) {
      const seen = Atomics.load(this.#signal, 0);
      this.#drain();
      const sent = this.#answers.get(n);
      const cancel = this.#cancels.get(n);
      if (sent === "written" || cancel === "written") {
        this.counts.sent++;
        return this.#settled(n, "written");
      }
      const refused = sent === "none" || sent === "refused" || sent === "failed";
      if (refused || cancel === "cancelled" || cancel === "failed") {
        return this.#settled(n, "not-written");
      }
      if (sent === "unknown" || cancel === "unknown" || cancel === "no-answer") {
        try {
          if (this.#direct(db, seq, batch, 0) === "written") this.counts.fallback.lost++;
          return this.#settled(n, "written");
        } catch (error) {
          if (!isBusy(error)) throw error;
        }
      }
      const now = performance.now();
      if (now >= deadline) return this.#settled(n, "unsettled");
      if (this.#port !== null && !this.#exited && now - askedAt >= ASK_AGAIN_MS) {
        this.#cancels.delete(n);
        this.#port.postMessage({ cancel: { n, seq } });
        askedAt = now;
      }
      Atomics.wait(this.#signal, 0, seen, Math.min(20, deadline - now));
    }
  }

  #settled<T>(n: number, end: T): T {
    this.#answers.delete(n);
    this.#cancels.delete(n);
    return end;
  }

  /**
   * Settles a batch left unsettled (`#write`): the store process wrote it
   * (its answer came), or it is written here under its mark, waiting at most
   * `busyMs` for the lock. False when the lock stayed busy: it stays pending,
   * and the batch at hand is not written.
   */
  #settlePending(db: DatabaseSync, busyMs: number): boolean {
    this.#drain();
    const pending = this.#pending;
    if (pending === null) return true;
    if (this.#answers.get(pending.n) !== "written") {
      try {
        if (this.#direct(db, pending.seq, pending.batch, busyMs) === "written") {
          this.counts.fallback.lost++;
        }
      } catch (error) {
        if (isBusy(error)) return false;
        // It cannot be written at all; the store process fails it as well.
      }
    }
    this.#settled(pending.n, null);
    this.#pending = null;
    return true;
  }

  /** The thread's answer for a new batch; `late` past `bound`, `busy` while it still sends an earlier one. */
  #send(
    n: number,
    seq: string,
    batch: readonly Statement[],
    bound: number,
  ): RelayOutcome | "late" | "busy" {
    this.#drain();
    if (this.#port === null || this.#closed || this.#exited) return "none";
    // The thread still sends an earlier batch, settled already: this one is written here.
    if (this.#inFlight !== null) return "busy";
    const { kind, splittable } = kinds.getStore() ?? { kind: "record", splittable: false };
    const job: RelayJob = { n, seq, kind, splittable, statements: batch };
    this.#inFlight = n;
    this.#port.postMessage({ job });
    const deadline = performance.now() + bound;
    for (;;) {
      const seen = Atomics.load(this.#signal, 0);
      this.#drain();
      const outcome = this.#answers.get(n);
      if (outcome === "unknown") return outcome;
      if (outcome !== undefined) return this.#settled(n, outcome);
      const left = deadline - performance.now();
      if (left <= 0) return "late";
      Atomics.wait(this.#signal, 0, seen, left);
    }
  }

  /** Takes the thread's answers. */
  #drain(): void {
    for (;;) {
      const received = this.#port === null ? undefined : receiveMessageOnPort(this.#port);
      if (received === undefined) return;
      const message = received.message as {
        n: number;
        outcome?: RelayOutcome;
        cancel?: CancelState;
      };
      if (message.cancel !== undefined) {
        this.#cancels.set(message.n, message.cancel);
        continue;
      }
      if (message.n === this.#inFlight) this.#inFlight = null;
      if (message.outcome !== undefined) this.#answers.set(message.n, message.outcome);
      // Answers no one waits for any more are dropped, but a pending batch's.
      for (const old of this.#answers.keys()) {
        if (this.#answers.size <= 8) break;
        if (old !== this.#pending?.n) this.#answers.delete(old);
      }
    }
  }

  /** Writes `batch` on `db` under its mark, waiting at most `busyMs` for the lock. */
  #direct(
    db: DatabaseSync,
    seq: string,
    batch: readonly Statement[],
    busyMs: number,
  ): "written" | "superseded" {
    let writer = this.#writers.get(db);
    if (writer === undefined) {
      writer = new GuardedWriter(db);
      this.#writers.set(db, writer);
    }
    const own = Number(Object.values(db.prepare("PRAGMA busy_timeout").get() ?? {})[0] ?? 0);
    db.exec(`PRAGMA busy_timeout = ${busyMs}`);
    db.exec("PRAGMA query_only = 0");
    try {
      const end = writer.write(this.#options.worktreeId, seq, batch);
      if (end.end === "superseded") this.counts.superseded++;
      else this.counts.direct++;
      return end.end === "superseded" ? "superseded" : "written";
    } finally {
      db.exec("PRAGMA query_only = 1");
      db.exec(`PRAGMA busy_timeout = ${own}`);
    }
  }
}

/** How long a write on `db` waits for the lock now: its busy timeout, or the caller's busy slice when shorter. */
function boundOf(db: DatabaseSync): number {
  const own = Number(Object.values(db.prepare("PRAGMA busy_timeout").get() ?? {})[0] ?? 0);
  const slice = busySliceMs();
  return slice !== null && slice < own ? slice : own;
}
