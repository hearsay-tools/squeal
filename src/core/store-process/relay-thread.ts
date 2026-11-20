import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { type MessagePort, parentPort, workerData } from "node:worker_threads";
import { codeStorePath } from "../code/store/open.js";
import { requestDaemon } from "../daemon/client.js";
import { leaseProcess } from "../daemon/lease-process.js";
import { acquireDaemonLock } from "../daemon/lock.js";
import { encodeBatch } from "../daemon/write-batch.js";
import { SMALL_REQUEST_TIMEOUT_MS } from "../delivery/daemon-writer.js";
import { createProcSource } from "../ps/proc.js";
import { logLongWrites, longWriteLine } from "../store/long-write.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { DaemonRequest, DaemonResponse } from "../types/daemon.js";
import { GuardedWriter } from "./guard.js";
import {
  BatchOwner,
  type Instance,
  OWNER_TIMING,
  type OwnedJob,
  type OwnerPorts,
  type OwnerTiming,
  type Settled,
} from "./owner.js";
import { storeProcessLockPath } from "./paths.js";
import { release } from "./release.js";
import { type StoreProcessLaunch, spawnStoreProcess } from "./spawn.js";

/*
 * Spec 021 D22.3 and D22.4 (row 021-36, rebuilt 2026-11-19): the daemon's
 * side of the store process, in a worker thread of its own. The main
 * thread posts each batch and goes on; this thread owns it until it is
 * written exactly once (`BatchOwner`), one batch at a time, so a
 * worktree's batches keep their order. It holds a lease at the store
 * process for the daemon's life, which is how that process counts its
 * clients, and answers each batch on the port.
 */

/** What the relay is told at its start. */
export interface RelayData {
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
  readonly socketPath: AbsolutePath;
  /** `null`: never start a store process, only use one that serves. */
  readonly launch: StoreProcessLaunch | null;
  readonly env: NodeJS.ProcessEnv;
  readonly port: MessagePort;
  /** Tests shorten the owner's bounds. */
  readonly timing?: Partial<OwnerTiming>;
}

/** To the relay thread: a batch to settle, or the end. */
export interface RelayMessage {
  readonly job?: OwnedJob;
  readonly close?: true;
  /** With `close`: the daemon was stopped on purpose (spec 021 D22.2). */
  readonly leaving?: boolean;
}

/** From the relay thread: how a batch ended, or a line for the daemon's log. */
export type RelayAnswer =
  | { readonly n: number; readonly settled: Settled }
  | { readonly log: string };

/** How long a ping may take before the store process counts as silent. */
const PING_MS = 1_000;
/** D1's bound for handing a batch over: a large batch takes long to send. */
const SUBMIT_MS = 10_000;

const data = workerData as RelayData | undefined;
if (parentPort !== null && data !== undefined) serve(data);

function serve(data: RelayData): void {
  const port = data.port;
  // D3: a write here that holds the lock past 250 ms is a line in the daemon's log.
  logLongWrites((write) => port.postMessage({ log: longWriteLine(write) }));
  const lockPath = storeProcessLockPath(data.commonDir, "code");
  let token: string | null = null;
  let leasedAt: Instance | null = null;
  let db: { readonly raw: DatabaseSync; readonly writer: GuardedWriter } | null = null;

  const ask = (request: DaemonRequest, timeoutMs: number): Promise<DaemonResponse> =>
    requestDaemon(data.socketPath, request, timeoutMs);

  const ports: OwnerPorts = {
    lockFree: () => {
      const lock = acquireDaemonLock(lockPath);
      lock?.release();
      return lock !== null;
    },
    start: () => {
      if (data.launch !== null) spawnStoreProcess(data.commonDir, data.launch, data.env);
    },
    ping: async () => {
      try {
        const answer = await ask({ type: "ping" }, PING_MS);
        if (!answer.ok || answer.type !== "ping") return null;
        const instance = { pid: answer.pid, startedAt: answer.startedAt };
        await lease(instance);
        return instance;
      } catch {
        return null;
      }
    },
    submit: async (job) => {
      const request = {
        type: "write",
        worktreeId: data.worktreeId,
        storeSchema: data.storeSchema,
        token: null,
        release: false,
        batch: encodeBatch(job.statements),
        kind: job.kind,
        splittable: job.splittable,
        seq: job.seq,
      } as const;
      try {
        const answer = await ask(request, SUBMIT_MS);
        if (!answer.ok) return { refused: answer.error };
        if (answer.type !== "write") return { refused: `unexpected answer ${answer.type}` };
        return { id: answer.requestId, state: answer };
      } catch {
        return "lost";
      }
    },
    status: async (id) => {
      try {
        const answer = await ask({ type: "write-status", requestId: id }, SMALL_REQUEST_TIMEOUT_MS);
        if (!answer.ok || answer.type !== "write") return "unknown";
        return answer;
      } catch {
        return "lost";
      }
    },
    holder: () => storeProcessHolder(lockPath),
    kill: (pid) => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Gone already.
      }
    },
    direct: (job, busyMs) => {
      db ??= openHere(data.commonDir);
      db.raw.exec(`PRAGMA busy_timeout = ${busyMs}`);
      return db.writer.write(data.worktreeId, job.seq, job.statements).end === "superseded"
        ? "superseded"
        : "written";
    },
    sleep: (ms) => sleep(ms),
    now: () => performance.now(),
  };

  /** The lease the store process counts this daemon by, taken again at each new instance. */
  const lease = async (instance: Instance) => {
    if (leasedAt?.pid === instance.pid && leasedAt.startedAt === instance.startedAt) return;
    leasedAt = instance;
    token = null;
    const request = {
      type: "lease",
      worktreeId: data.worktreeId,
      holder: `${process.pid} daemon`,
      process: leaseProcess(),
    } as const;
    const answer = await ask(request, SMALL_REQUEST_TIMEOUT_MS).catch(() => null);
    if (answer?.ok === true && answer.type === "lease") token = answer.token;
  };

  const owner = new BatchOwner(ports, timingOf(data.timing));
  let closing = false;
  // One batch at a time, in order: the store process keeps a worktree's batches in the order sent.
  let chain = Promise.resolve();
  port.on("message", (message: RelayMessage) => {
    if (message.close === true) {
      closing = true;
      const leaving = message.leaving === true;
      chain = chain.then(async () => {
        await release(data, token, leaving);
        db?.raw.close();
        port.close();
      });
      return;
    }
    const job = message.job;
    if (job === undefined || closing) return;
    chain = chain.then(async () => {
      port.postMessage({ n: job.n, settled: await owner.settle(job) });
    });
  });
}

function timingOf(timing: Partial<OwnerTiming> | undefined): OwnerTiming {
  return { ...OWNER_TIMING, ...timing };
}

/** This thread's own write connection, used only while no store process lives. */
function openHere(commonDir: AbsolutePath): { raw: DatabaseSync; writer: GuardedWriter } {
  const raw = new DatabaseSync(codeStorePath(commonDir));
  raw.exec("PRAGMA synchronous = NORMAL");
  return { raw, writer: new GuardedWriter(raw) };
}

/**
 * The pid that holds the store process's lock file, read from
 * `/proc/locks`, when its command line is a store process's; `null`
 * elsewhere, or when another process holds it (`squeal remove`).
 */
function storeProcessHolder(lockPath: AbsolutePath): number | null {
  if (process.platform !== "linux") return null;
  try {
    const source = createProcSource();
    const key = source.fileKey(lockPath);
    if (key === null) return null;
    for (const lock of source.locks() ?? []) {
      if (lock.file !== key || lock.blocked || lock.pid === null || lock.pid === process.pid)
        continue;
      const args = source.cmdline(lock.pid) ?? cmdlineOf(lock.pid);
      if (args.includes("store-process")) return lock.pid;
    }
  } catch {
    // Unreadable: nothing is ended.
  }
  return null;
}

function cmdlineOf(pid: number): readonly string[] {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
  } catch {
    return [];
  }
}
