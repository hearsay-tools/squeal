import { DatabaseSync } from "node:sqlite";
import { codeStorePath } from "../code/store/open.js";
import { acquireDaemonLock } from "../daemon/lock.js";
import { prepareSocketDir } from "../daemon/paths.js";
import { errorResponse } from "../daemon/protocol.js";
import { createDaemonServer, type DaemonServer } from "../daemon/server.js";
import { WriteDesk } from "../daemon/write-desk.js";
import { isWriteRequest } from "../daemon/write-protocol.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { DaemonPhase, DaemonRequest, DaemonResponse } from "../types/daemon.js";
import type { SentBatch, WriteRequest } from "../types/daemon-writes.js";
import { storeProcessLockPath, storeProcessSocketPath } from "./paths.js";
import { WriteQueue } from "./queue.js";
import { type StoreWriter, startWriter, type WriterScript } from "./writer.js";

/*
 * Spec 021 D22 (row 021-36): the store process of one clone's `code.sqlite`.
 * It holds `locks/store-code.sqlite` for its life, so of two started at once
 * one serves and the other exits; it answers the daemons' writes on its
 * socket with D15's requests (`WriteDesk`, one per worktree), queues their
 * batches (`WriteQueue`) and writes them one at a time off the socket's
 * thread (`StoreWriter`). It exits once no client has held a lease for
 * `graceMs`, and at once when the file's schema is newer than its own.
 */

/** D22.2: how long the store process outlives its last client (coordinator 8f88fe1f, 2026-11-19). */
export const STORE_PROCESS_GRACE_MS = 5 * 60_000;

/** How often the process counts its clients and reads the file's schema. */
const CHECK_MS = 10_000;

/** D22.3, D3: the longest slice of a splittable batch. */
export const SLICE_MS = 250;

export interface StoreProcessOptions {
  readonly commonDir: AbsolutePath;
  readonly log: (line: string) => void;
  /** Default `writerScript()`'s answer, given by the caller. */
  readonly writer: WriterScript | null;
  readonly graceMs?: number;
  readonly checkMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Milliseconds that never go back. Default `performance.now`. */
  readonly now?: () => number;
}

/** Why the store process ended. */
export type StoreProcessEnd = "lost-lock" | "open-failed" | "idle" | "newer-schema" | "stopped";

export interface RunningStoreProcess {
  readonly socketPath: AbsolutePath;
  readonly schema: number;
  /** Resolves once it stopped, with why. */
  readonly ended: Promise<StoreProcessEnd>;
  /** Stops it: the queued batches are refused, and their clients write them. */
  stop(): Promise<StoreProcessEnd>;
}

interface Item {
  readonly request: WriteRequest;
  from: number;
  resolve(): void;
  reject(error: Error): void;
}

/** Starts serving; an end when it never served. */
export async function startStoreProcess(
  options: StoreProcessOptions,
): Promise<RunningStoreProcess | StoreProcessEnd> {
  const { commonDir, log } = options;
  const lock = acquireDaemonLock(storeProcessLockPath(commonDir, "code"));
  if (lock === null) return "lost-lock";
  const writer = startWriter(commonDir, options.writer);
  const ready = await writer.ready;
  if ("failed" in ready) {
    log(`store process: ${ready.failed}`);
    await writer.close();
    lock.release();
    return ready.failed.includes("newer-schema") ? "newer-schema" : "open-failed";
  }
  const now = options.now ?? (() => performance.now());
  const queue = new WriteQueue<Item>();
  const desks = new Map<WorktreeId, WriteDesk>();
  let phase: DaemonPhase = "ready";
  let pumping = false;
  let endWith: (end: StoreProcessEnd) => void = () => {};
  const ended = new Promise<StoreProcessEnd>((resolve) => {
    endWith = resolve;
  });

  const requestWrite = (_batch: SentBatch, request: WriteRequest) =>
    new Promise<void>((resolve, reject) => {
      if (phase === "stopping") reject(new Error("the store process is stopping"));
      else if (request.seq === undefined)
        reject(new Error("a store process writes numbered batches only"));
      else {
        queue.push(request.worktreeId, request.kind ?? "record", {
          request,
          from: 0,
          resolve,
          reject,
        });
        void pump();
      }
    });
  const deskOf = (worktreeId: WorktreeId): WriteDesk => {
    let desk = desks.get(worktreeId);
    if (desk === undefined) {
      desk = new WriteDesk({ worktreeId, storeSchema: ready.schema, requestWrite, now });
      desks.set(worktreeId, desk);
    }
    return desk;
  };
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (let next = queue.peek(); next !== null; next = queue.peek()) {
        await runOne(writer, next.item, () => queue.remove(next), log);
      }
    } finally {
      pumping = false;
    }
  };
  /** When a client last held a lease or asked anything. */
  let lastClient = now();
  const handle = (request: DaemonRequest): DaemonResponse => {
    lastClient = now();
    if (!isWriteRequest(request)) return errorResponse("a store process answers writes only");
    if (request.type === "write-status") {
      for (const desk of desks.values()) {
        const answer = desk.status(request);
        if (answer.ok) return answer;
      }
      return errorResponse(`unknown request id ${request.requestId}`);
    }
    if (request.type === "write" && request.storeSchema > ready.schema) {
      log(
        `store process: a client writes schema ${request.storeSchema}, newer than ${ready.schema}`,
      );
      void stop("newer-schema");
    }
    return deskOf(request.worktreeId).answer(request, phase);
  };

  const socketPath = storeProcessSocketPath(commonDir, "code", options.env);
  let server: DaemonServer;
  try {
    prepareSocketDir(socketPath, options.env);
    server = await createDaemonServer(socketPath, handle);
  } catch (error) {
    log(`store process: could not serve ${socketPath}: ${String(error)}`);
    await writer.close();
    lock.release();
    return "open-failed";
  }
  log(
    `store process: serving ${codeStorePath(commonDir)} at schema ${ready.schema} on ${socketPath}`,
  );

  const graceMs = options.graceMs ?? STORE_PROCESS_GRACE_MS;
  const check = () => {
    if ([...desks.values()].some((desk) => desk.leased) || queue.size > 0) lastClient = now();
    else if (now() - lastClient >= graceMs) void stop("idle");
    if (fileSchema(commonDir) > ready.schema) void stop("newer-schema");
  };
  const timer = setInterval(check, Math.min(options.checkMs ?? CHECK_MS, graceMs));
  let stopping: Promise<StoreProcessEnd> | null = null;
  const stop = (why: StoreProcessEnd): Promise<StoreProcessEnd> => {
    stopping ??= (async () => {
      phase = "stopping";
      clearInterval(timer);
      log(`store process: stopping (${why})`);
      while (pumping) await new Promise((resolve) => setTimeout(resolve, 5));
      for (const item of queue.drain()) item.reject(new Error("the store process is stopping"));
      await server.close();
      await writer.close();
      lock.release();
      endWith(why);
      return why;
    })();
    return stopping;
  };
  return { socketPath, schema: ready.schema, ended, stop: () => stop("stopped") };
}

/** Writes one slice of `item`; settles it when it ended, and leaves a cut batch at its head. */
async function runOne(
  writer: StoreWriter,
  item: Item,
  remove: () => void,
  log: (line: string) => void,
): Promise<void> {
  const { request } = item;
  try {
    const end = await writer.run({
      worktreeId: request.worktreeId,
      seq: request.seq as string,
      batch: request.batch,
      from: item.from,
      ...(request.splittable === true ? { sliceMs: SLICE_MS } : {}),
    });
    if (end.end === "partial") {
      item.from = end.next;
      return;
    }
    remove();
    item.resolve();
  } catch (error) {
    remove();
    log(`store process: a batch of ${request.worktreeId} failed: ${String(error)}`);
    item.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The file's `user_version`; 0 when it cannot be read. */
function fileSchema(commonDir: AbsolutePath): number {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(codeStorePath(commonDir), { readOnly: true });
    return Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0] ?? 0);
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}
