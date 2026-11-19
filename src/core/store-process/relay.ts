import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { MessageChannel, type MessagePort, Worker } from "node:worker_threads";
import type { OpenCodeStoreOptions } from "../code/store/open.js";
import type { Statement } from "../daemon/write-batch.js";
import { SendingConnection, type WriteSender } from "../delivery/sending-connection.js";
import type { Connection } from "../store/connection.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import { batchSeq } from "./guard.js";
import type { OwnedJob, OwnerTiming, Settled } from "./owner.js";
import { storeProcessSocketPath } from "./paths.js";
import type { WriteKind } from "./queue.js";
import { noFallback, type RelayCounts, reportLine, snapshotOf } from "./relay-counts.js";
import type { RelayAnswer, RelayData } from "./relay-thread.js";
import type { StoreProcessLaunch } from "./spawn.js";

/*
 * Spec 021 D22.3 and D22.4 (row 021-36, rebuilt 2026-11-19 on one rule):
 * a daemon's code-store writes go to the clone's store process. Each
 * connection the daemon opens is a `SendingConnection` (D15's client) that
 * hands each transaction's statements to this relay as one batch and goes
 * on: the daemon's main thread never waits for a write. The relay's thread
 * (`relay-thread.ts`, `BatchOwner`) owns each batch until it is written
 * exactly once. A caller that reads what it wrote awaits its own earlier
 * batches (`sent()`); a batch that failed is thrown by its connection's
 * next transaction or `sent()`, and its connection's batches sent before
 * that are not written. With no relay script, the daemon writes with a
 * plain `Connection`, as before this row.
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
  /** Tests shorten the thread's bounds. */
  readonly timing?: Partial<OwnerTiming>;
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

/** SQLite's busy error, as `isBusy` reads it, so callers treat it as a busy store. */
function locked(message: string): Error {
  return Object.assign(new Error(`database is locked: ${message}`), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5,
  });
}

/** D22.6: how often the daemon logs its code-store batches. */
const REPORT_MS = 60_000;
/**
 * How long a daemon's stop waits for its batches still owned by the
 * thread; past it they are left to the store process that holds them, or
 * not written, as at a crash. No caller is left to retry them.
 */
const CLOSE_MS = 5_000;

/** A batch handed over, and how its caller hears of its end. */
interface Posted {
  readonly epoch: number;
  readonly epochNow: () => number;
  resolve(): void;
  reject(error: Error): void;
}

export class CodeRelay {
  readonly counts: RelayCounts = {
    sent: 0,
    direct: 0,
    superseded: 0,
    failed: 0,
    fallback: noFallback(),
  };
  /** The counts at the last line logged. */
  #reported = snapshotOf(this.counts);
  #reporter: NodeJS.Timeout | null = null;
  readonly #options: CodeRelayOptions;
  readonly #port: MessagePort | null = null;
  readonly #worker: Worker | null = null;
  readonly #start = Date.now();
  #counter = 0;
  #connections = 0;
  readonly #posted = new Map<number, Posted>();
  /** Review of 0.1.571 B4: the thread ended (also before `close`, as at a failed start). */
  #exited = false;
  #exit: Promise<void> = Promise.resolve();
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
      ...(options.timing === undefined ? {} : { timing: options.timing }),
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
        this.#abandon("the daemon's code-store relay ended");
        resolve();
      });
    });
    this.#worker.unref();
    port1.on("message", (answer: RelayAnswer) => this.#answer(answer));
    // Held open only while a batch waits for its answer.
    port1.unref();
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
    const conn = ++this.#connections;
    let epoch = 0;
    const sender: WriteSender = {
      leased: true,
      send: async () => "not-taken",
      release: async () => {},
      post: (batch) => this.#post(batch, conn, epoch, () => epoch),
      surfaced: () => {
        epoch++;
      },
    };
    return new SendingConnection(db, sender);
  }

  /** Batches handed over and not settled yet. */
  get unsettled(): number {
    return this.#posted.size;
  }

  /**
   * Ends the thread once it settled what it holds, within `CLOSE_MS`; its
   * lease at the store process ends with it.
   */
  async close(leaving = false): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#reporter !== null) clearInterval(this.#reporter);
    const worker = this.#worker;
    if (worker !== null && !this.#exited) {
      this.#port?.postMessage({ close: true, leaving });
      const cap = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
      await Promise.race([this.#exit, cap(CLOSE_MS)]);
      if (!this.#exited) {
        await worker.terminate().catch(() => {});
        await Promise.race([this.#exit, cap(1_000)]);
      }
    }
    this.#abandon("the daemon stopped before this code-store batch was written");
    this.#port?.close();
    this.#report();
  }

  /** D22.6: the line of the batches since the last (`reportLine`), when there were any. */
  #report(): void {
    const line = reportLine(this.counts, this.#reported);
    this.#reported = snapshotOf(this.counts);
    if (line !== null) this.#options.log?.(line);
  }

  /** Hands `batch` to the thread; resolves once it is written, rejects when it never will be. */
  #post(
    batch: readonly Statement[],
    conn: number,
    epoch: number,
    epochNow: () => number,
  ): Promise<void> {
    if (this.#port === null || this.#closed || this.#exited) {
      this.counts.failed++;
      return Promise.reject(new Error("squeal: the daemon's code-store relay is closed"));
    }
    const { kind, splittable } = kinds.getStore() ?? { kind: "record", splittable: false };
    const n = ++this.#counter;
    const job: OwnedJob = {
      n,
      seq: batchSeq(this.#start, n),
      kind,
      splittable,
      statements: batch,
      conn,
      epoch,
    };
    return new Promise<void>((resolve, reject) => {
      this.#posted.set(n, { epoch, epochNow, resolve, reject });
      this.#port?.ref();
      this.#port?.postMessage({ job });
    });
  }

  #answer(answer: RelayAnswer): void {
    if ("log" in answer) {
      this.#options.log?.(answer.log);
      return;
    }
    const posted = this.#posted.get(answer.n);
    this.#posted.delete(answer.n);
    if (this.#posted.size === 0) this.#port?.unref();
    this.#count(answer.settled);
    if (posted === undefined) return;
    const { settled } = answer;
    if (!("failed" in settled)) posted.resolve();
    // Its caller saw a failure since it was sent: this one follows from it, and is not told again.
    else if (posted.epochNow() > posted.epoch) posted.resolve();
    else posted.reject(failureOf(settled));
  }

  #count(settled: Settled): void {
    if ("failed" in settled) this.counts.failed++;
    else if (settled.by === "store") {
      this.counts.sent++;
      if (settled.marked) this.counts.superseded++;
    } else {
      this.counts.direct++;
      this.counts.fallback[settled.why]++;
    }
  }

  /** Every batch not settled is told it was not written. */
  #abandon(why: string): void {
    for (const [n, posted] of this.#posted) {
      this.#posted.delete(n);
      this.counts.failed++;
      posted.reject(new Error(`squeal: ${why}`));
    }
  }
}

function failureOf(settled: { readonly failed: string; readonly busy: boolean }): Error {
  return settled.busy
    ? locked(`a code-store batch could not be written: ${settled.failed}`)
    : new Error(`squeal: a code-store batch failed: ${settled.failed}`);
}
