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
import { busySliceMs, type Connection } from "../store/connection.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import { batchSeq, GuardedWriter } from "./guard.js";
import { storeProcessSocketPath } from "./paths.js";
import type { WriteKind } from "./queue.js";
import type { RelayData, RelayJob, RelayOutcome } from "./relay-thread.js";
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
}

/** How the daemon's batches went, for tests and the D22.6 measurement. */
export interface RelayCounts {
  /** Written by the store process. */
  sent: number;
  /** Written here: no store process took them, or none answered in the bound. */
  direct: number;
  /** Found written already by the mark when written here. */
  superseded: number;
  /** Not answered within the bound. */
  late: number;
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

export class CodeRelay {
  readonly counts: RelayCounts = { sent: 0, direct: 0, superseded: 0, late: 0 };
  readonly #options: CodeRelayOptions;
  readonly #signal = new Int32Array(new SharedArrayBuffer(4));
  readonly #port: MessagePort | null = null;
  readonly #worker: Worker | null = null;
  readonly #start = Date.now();
  readonly #writers = new WeakMap<DatabaseSync, GuardedWriter>();
  #counter = 0;
  /** The batch the thread still sends, answered or not. */
  #inFlight: number | null = null;
  #closed = false;

  constructor(options: CodeRelayOptions) {
    this.#options = options;
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
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const worker = this.#worker;
    if (worker === null) return;
    this.#port?.postMessage({ close: true });
    const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
    const timer = setTimeout(() => void worker.terminate(), 1_000);
    await exited;
    clearTimeout(timer);
  }

  /** Writes `batch`: through the store process when it answers within the bound, else here. */
  #write(db: DatabaseSync, batch: readonly Statement[]): void {
    const seq = batchSeq(this.#start, ++this.#counter);
    const bound = boundOf(db);
    const started = performance.now();
    const outcome = this.#send(seq, batch, bound);
    if (outcome === "written") {
      this.counts.sent++;
      return;
    }
    if (outcome === "late") this.counts.late++;
    // A late batch may still be written there: the mark settles it under the lock, waiting no more.
    const left = outcome === "late" ? 0 : Math.max(0, bound - (performance.now() - started));
    this.#direct(db, seq, batch, Math.round(left));
  }

  /** The thread's answer for a new batch; `late` past `bound`, `not-taken` with no thread free. */
  #send(seq: string, batch: readonly Statement[], bound: number): RelayOutcome | "late" {
    this.#drain();
    if (this.#port === null || this.#closed || this.#inFlight !== null) return "not-taken";
    const n = this.#counter;
    const { kind, splittable } = kinds.getStore() ?? { kind: "record", splittable: false };
    const job: RelayJob = { n, seq, kind, splittable, statements: batch };
    const seen = Atomics.load(this.#signal, 0);
    this.#inFlight = n;
    this.#port.postMessage({ job });
    const deadline = performance.now() + bound;
    let last = seen;
    for (;;) {
      const outcome = this.#drain(n);
      if (outcome !== null) return outcome;
      const left = deadline - performance.now();
      if (left <= 0) return "late";
      Atomics.wait(this.#signal, 0, last, left);
      last = Atomics.load(this.#signal, 0);
    }
  }

  /** Reads the thread's answers; the one for batch `n`, when given and there. */
  #drain(n?: number): RelayOutcome | null {
    let found: RelayOutcome | null = null;
    for (;;) {
      const received = this.#port === null ? undefined : receiveMessageOnPort(this.#port);
      if (received === undefined) return found;
      const { n: of, outcome } = received.message as { n: number; outcome: RelayOutcome };
      if (of === this.#inFlight) this.#inFlight = null;
      if (of === n) found = outcome;
    }
  }

  /** Writes `batch` on `db` under its mark, waiting at most `busyMs` for the lock. */
  #direct(db: DatabaseSync, seq: string, batch: readonly Statement[], busyMs: number): void {
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
