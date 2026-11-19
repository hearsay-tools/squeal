import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { codeStorePath } from "../code/store/open.js";
import { acquireDaemonLock } from "../daemon/lock.js";
import { prepareSocketDir } from "../daemon/paths.js";
import { errorResponse } from "../daemon/protocol.js";
import { createDaemonServer, type DaemonServer } from "../daemon/server.js";
import { pauseAt } from "../daemon/test-pause.js";
import { squealVersion } from "../daemon/version.js";
import { WriteDesk } from "../daemon/write-desk.js";
import { isWriteRequest } from "../daemon/write-protocol.js";
import {
  type AbsolutePath,
  type EpochMs,
  PAYLOAD_SCHEMA_VERSION,
  type WorktreeId,
} from "../types/common.js";
import type { DaemonPhase, DaemonRequest, DaemonResponse } from "../types/daemon.js";
import type { SentBatch, WriteRequest } from "../types/daemon-writes.js";
import { Batches } from "./batches.js";
import { storeProcessLockPath, storeProcessSocketPath } from "./paths.js";
import { WriteQueue } from "./queue.js";
import { WriteStats } from "./stats.js";
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

/** D22.6: how often the process logs what it wrote. */
const REPORT_MS = 60_000;

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
  /** D22.6: how often it logs what it wrote, when it wrote anything. Default a minute. */
  readonly reportMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Milliseconds that never go back. Default `performance.now`. */
  readonly now?: () => number;
}

/** Why the store process ended. */
export type StoreProcessEnd =
  | "lost-lock"
  | "open-failed"
  | "idle"
  | "newer-schema"
  | "stopped"
  /** Its file is gone: the repository or its store was removed under it. */
  | "removed";

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
  /** When it was queued, and when its first slice began; for D22.6's queue wait. */
  readonly queuedAt: number;
  startedAt: number | null;
  /** The writer's time on it so far. */
  busyMs: number;
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
  const writer = startWriter(commonDir, options.writer, log);
  const ready = await writer.ready;
  if ("failed" in ready) {
    log(`store process: ${ready.failed}`);
    await writer.close();
    lock.release();
    return ready.failed.includes("newer-schema") ? "newer-schema" : "open-failed";
  }
  const now = options.now ?? (() => performance.now());
  const queue = new WriteQueue<Item>();
  const batches = new Batches<Item>(queue);
  const stats = new WriteStats();
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
        const queued = queue.push(request.worktreeId, request.kind ?? "record", {
          request,
          from: 0,
          queuedAt: now(),
          startedAt: null,
          busyMs: 0,
          resolve,
          reject,
        });
        batches.queued(request.worktreeId, request.seq, queued);
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
  /**
   * Review of 0.1.571 N1: the last client's daemon was stopped on purpose
   * (a `release` with `leaving`). Asked again whenever a batch ends, so a
   * release that came while its write waited still stops the process once
   * that write settled; a new lease forgets it.
   */
  let leavingAsked = false;
  const afterLeaving = () => {
    if (!leavingAsked) return;
    // After the desks settled the batch that just ended (their `then` runs after it).
    setImmediate(() => {
      if (leavingAsked && queue.size === 0 && ![...desks.values()].some((desk) => desk.leased))
        void stop("stopped");
    });
  };
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      // Once stopping, nothing more is begun: what waits is refused by the stop (review of 0.1.571).
      for (let next = queue.peek(); next !== null && phase !== "stopping"; next = queue.peek()) {
        await runOne(writer, next.item, () => queue.remove(next), {
          log,
          now,
          ended: (written) => {
            const { item } = next;
            const waited = (item.startedAt ?? now()) - item.queuedAt;
            stats.record(next.kind, written, waited, item.busyMs);
            batches.ended(next.worktreeId, item.request.seq as string, written);
            afterLeaving();
          },
        });
      }
    } finally {
      pumping = false;
    }
  };
  /** When a client last held a lease or asked anything. */
  let lastClient = now();
  const startedAt = Date.now() as EpochMs;
  const handle = (request: DaemonRequest): DaemonResponse => {
    lastClient = now();
    // D22.4: a relay asks whether this process still answers before it ends one that does not.
    if (request.type === "ping") {
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        ok: true,
        type: "ping",
        pid: process.pid,
        worktreeId: "" as WorktreeId,
        root: commonDir,
        squealVersion: squealVersion(),
        phase,
        startedAt,
      };
    }
    // `squeal remove` stops it once the daemons stopped, then takes its lock (review of 0.1.571).
    if (request.type === "stop") {
      void stop("stopped");
      return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "stop" };
    }
    if (!isWriteRequest(request)) return errorResponse("a store process answers writes only");
    if (request.type === "write-cancel") return batches.cancel(request);
    if (request.type === "lease") leavingAsked = false;
    if (request.type === "release" && request.leaving === true) {
      // D22.2: the client's daemon was stopped on purpose; with no client left, no grace either.
      const answer = deskOf(request.worktreeId).answer(request, phase);
      leavingAsked = true;
      afterLeaving();
      return answer;
    }
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
    // A repository removed under it (a harness's temp checkout, a test's) leaves nothing to serve.
    if (!existsSync(codeStorePath(commonDir))) void stop("removed");
  };
  const timer = setInterval(check, Math.min(options.checkMs ?? CHECK_MS, graceMs));
  // D22.6: a line a minute while it wrote anything.
  const report = setInterval(() => {
    const line = stats.take();
    if (line !== null) log(`store process: last minute: ${line}`);
  }, options.reportMs ?? REPORT_MS);
  report.unref();
  let stopping: Promise<StoreProcessEnd> | null = null;
  const stop = (why: StoreProcessEnd): Promise<StoreProcessEnd> => {
    stopping ??= (async () => {
      phase = "stopping";
      clearInterval(timer);
      clearInterval(report);
      while (pumping) await new Promise((resolve) => setTimeout(resolve, 5));
      for (const { kind, worktreeId, item } of queue.drainQueued()) {
        stats.record(kind, false, now() - item.queuedAt, item.busyMs);
        batches.ended(worktreeId, item.request.seq as string, false);
        item.reject(new Error("the store process is stopping"));
      }
      log(`store process: stopping (${why}): ${stats.take() ?? "no batches since the last line"}`);
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
interface RunContext {
  readonly log: (line: string) => void;
  readonly now: () => number;
  /** The batch ended, written or not: for D22.6's counts. */
  readonly ended: (written: boolean) => void;
}

async function runOne(
  writer: StoreWriter,
  item: Item,
  remove: () => void,
  { log, now, ended }: RunContext,
): Promise<void> {
  const { request } = item;
  const began = now();
  item.startedAt ??= began;
  try {
    const end = await writer.run({
      worktreeId: request.worktreeId,
      seq: request.seq as string,
      batch: request.batch,
      from: item.from,
      ...(request.splittable === true ? { sliceMs: SLICE_MS } : {}),
    });
    item.busyMs += now() - began;
    if (end.end === "partial") {
      item.from = end.next;
      return;
    }
    pauseAt("store-written");
    remove();
    ended(true);
    item.resolve();
  } catch (error) {
    item.busyMs += now() - began;
    remove();
    ended(false);
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
