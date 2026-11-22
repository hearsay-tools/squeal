import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { codeStorePath, isCodeStoreOpenFailure, openCodeStore } from "../code/store/open.js";
import { passiveCheckpoint } from "../daemon/idle-checkpoint.js";
import { decodeBatch } from "../daemon/write-batch.js";
import { Connection } from "../store/connection.js";
import { logLongWrites, longWriteLine } from "../store/long-write.js";
import { CONNECTION_PRAGMAS } from "../store/open.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { SentBatch } from "../types/daemon-writes.js";
import {
  type GuardedEnd,
  type GuardedSlice,
  type GuardedStatement,
  GuardedWriter,
} from "./guard.js";

/*
 * Spec 021 D22.3 (row 021-36): the store process's one write connection,
 * in a worker thread when its script is there, so a long write never
 * delays an answer on the socket. Run from the TypeScript sources with no
 * loader, it writes on the calling thread, as the daemon's front desk
 * serves its socket there.
 */

/** One slice of one batch to write. */
export interface WriteJob {
  readonly worktreeId: WorktreeId;
  readonly seq: string;
  readonly batch: SentBatch;
  readonly from: number;
  /** Set for a splittable batch: the slice's length. */
  readonly sliceMs?: number;
}

/** The file opened, at its schema; or why it did not open. */
export type WriterReady = { readonly schema: number } | { readonly failed: string };

export interface StoreWriter {
  readonly ready: Promise<WriterReady>;
  run(job: WriteJob): Promise<GuardedEnd>;
  close(): Promise<void>;
}

/** The writer's script and the Node options that load it; `null`: write on this thread. */
export interface WriterScript {
  readonly script: string;
  readonly execArgv?: readonly string[];
}

/** The writer looks at the WAL for a passive checkpoint at most this often (spec 024 D5). */
export const WRITER_CHECKPOINT_MS = 1_000;

/**
 * Spec 024 D5: a writer whose connection never checkpoints at a commit
 * (`wal_autocheckpoint = 0`), so no batch holds the write lock through a
 * 1,000-page checkpoint. After a write, outside its transaction, it runs a
 * passive checkpoint while the WAL is large (`passiveCheckpoint`), so the
 * WAL stays bounded under sustained writes.
 */
export class CheckpointingWriter extends GuardedWriter {
  readonly #db: DatabaseSync;
  readonly #walPath: string;
  readonly #now: () => number;
  #looked = Number.NEGATIVE_INFINITY;

  constructor(db: DatabaseSync, walPath: string, now: () => number = () => performance.now()) {
    super(db);
    this.#db = db;
    this.#walPath = walPath;
    this.#now = now;
  }

  override write(
    worktreeId: WorktreeId,
    seq: string,
    statements: readonly GuardedStatement[],
    slice: GuardedSlice = {},
  ): GuardedEnd {
    try {
      return super.write(worktreeId, seq, statements, slice);
    } finally {
      this.#checkpoint();
    }
  }

  #checkpoint(): void {
    const at = this.#now();
    if (at - this.#looked < WRITER_CHECKPOINT_MS) return;
    this.#looked = at;
    try {
      passiveCheckpoint(this.#db, this.#walPath);
    } catch {
      // The next write's look tries again.
    }
  }
}

/** Opens the code store of `commonDir` for writing: the writer and the file's schema. */
export function openWriteConnection(
  commonDir: AbsolutePath,
): { readonly writer: GuardedWriter; readonly schema: number; close(): void } | string {
  let db: DatabaseSync | null = null;
  const opened = openCodeStore(
    commonDir,
    { complexity: { enabled: true } as never },
    {
      connection: (raw) => {
        db = raw;
        return new Connection(raw);
      },
    },
  );
  if (isCodeStoreOpenFailure(opened))
    return `the code store did not open: ${JSON.stringify(opened)}`;
  const raw = db as DatabaseSync | null;
  if (raw === null) return "the code store did not open: no connection";
  for (const pragma of CONNECTION_PRAGMAS) raw.exec(pragma);
  raw.exec("PRAGMA wal_autocheckpoint = 0");
  return {
    writer: new CheckpointingWriter(raw, `${codeStorePath(commonDir)}-wal`),
    schema: opened.schemaVersion,
    close: () => opened.close(),
  };
}

/** Runs one job on `writer`. */
export function runJob(writer: GuardedWriter, job: WriteJob, schema: number): GuardedEnd {
  return writer.write(job.worktreeId, job.seq, decodeBatch(job.batch), {
    from: job.from,
    schema,
    ...(job.sliceMs === undefined ? {} : { sliceMs: job.sliceMs }),
  });
}

/**
 * The writer script beside `module`: `writer-thread.js` in the `tsc` build,
 * `store-writer.mjs` beside the CLI bundle; `writer-thread.ts` from the
 * sources only when this process runs with a loader (`execArgv` names one).
 */
export function writerScript(module: URL = new URL(import.meta.url)): WriterScript | null {
  for (const name of ["./writer-thread.js", "./store-writer.mjs"]) {
    const script = fileURLToPath(new URL(name, module));
    if (existsSync(script)) return { script };
  }
  const source = fileURLToPath(new URL("./writer-thread.ts", module));
  const loader = process.execArgv.some((arg) => arg === "--import" || arg.startsWith("--import="));
  return loader && existsSync(source) ? { script: source } : null;
}

/** The store's writer: in a worker thread with `script`, else on this thread. */
export function startWriter(
  commonDir: AbsolutePath,
  script: WriterScript | null,
  log: (line: string) => void,
): StoreWriter {
  return script === null ? inThread(commonDir, log) : inWorker(commonDir, script, log);
}

function inThread(commonDir: AbsolutePath, log: (line: string) => void): StoreWriter {
  // D3 (review of 0.1.571): its long writes go to the store process's log.
  logLongWrites((write) => log(`store process: ${longWriteLine(write)}`));
  const opened = openWriteConnection(commonDir);
  return {
    ready: Promise.resolve(
      typeof opened === "string" ? { failed: opened } : { schema: opened.schema },
    ),
    run: async (job) => {
      if (typeof opened === "string") throw new Error(opened);
      return runJob(opened.writer, job, opened.schema);
    },
    close: async () => {
      if (typeof opened !== "string") opened.close();
    },
  };
}

type FromWorker =
  | { readonly type: "log"; readonly line: string }
  | { readonly type: "ready"; readonly ready: WriterReady }
  | { readonly type: "done"; readonly id: number; readonly end: GuardedEnd }
  | { readonly type: "failed"; readonly id: number; readonly error: string };

function inWorker(
  commonDir: AbsolutePath,
  script: WriterScript,
  log: (line: string) => void,
): StoreWriter {
  const worker = new Worker(script.script, {
    workerData: { commonDir },
    ...(script.execArgv === undefined ? {} : { execArgv: [...script.execArgv] }),
  });
  const waiting = new Map<number, { resolve(end: GuardedEnd): void; reject(e: Error): void }>();
  let ids = 0;
  let dead: Error | null = null;
  let readied: (ready: WriterReady) => void = () => {};
  const ready = new Promise<WriterReady>((resolve) => {
    readied = resolve;
  });
  const fail = (error: Error) => {
    dead ??= error;
    readied({ failed: error.message });
    for (const { reject } of waiting.values()) reject(error);
    waiting.clear();
  };
  worker.on("message", (message: FromWorker) => {
    if (message.type === "log") {
      log(message.line);
      return;
    }
    if (message.type === "ready") {
      readied(message.ready);
      return;
    }
    const job = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.type === "done") job?.resolve(message.end);
    else job?.reject(new Error(message.error));
  });
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`the store writer exited with code ${code}`)));
  return {
    ready,
    run: (job) =>
      new Promise<GuardedEnd>((resolve, reject) => {
        if (dead !== null) {
          reject(dead);
          return;
        }
        const id = ids++;
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, job });
      }),
    close: async () => {
      worker.postMessage({ close: true });
      await new Promise<void>((resolve) => {
        if (dead !== null) resolve();
        else worker.once("exit", () => resolve());
      });
    },
  };
}
