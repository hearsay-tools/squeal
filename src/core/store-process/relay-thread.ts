import { existsSync } from "node:fs";
import { type MessagePort, parentPort, workerData } from "node:worker_threads";
import type { Statement } from "../daemon/write-batch.js";
import { DaemonWriter } from "../delivery/daemon-writer.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { WriteKind } from "./queue.js";
import { type StoreProcessLaunch, spawnStoreProcess } from "./spawn.js";

/*
 * Spec 021 D22 (row 021-36): the daemon's side of the store process, in a
 * worker thread of its own, so the daemon's main thread can wait for a
 * batch with `Atomics.wait` while this thread talks to the socket. It sends
 * each batch with D15's client (`DaemonWriter`) under the worktree's lease,
 * held for the daemon's life, which is how the store process counts its
 * clients. Each answer goes back on the port, and the shared counter wakes
 * the main thread.
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
  readonly signal: SharedArrayBuffer;
}

/** One batch to send. */
export interface RelayJob {
  readonly n: number;
  readonly seq: string;
  readonly kind: WriteKind;
  readonly splittable: boolean;
  readonly statements: readonly Statement[];
}

/**
 * How it went: `written` by the store process (or found written by the
 * mark), `not-taken` surely not written there, `unknown` sent and then
 * lost, so only the mark can tell.
 */
export type RelayOutcome = "written" | "not-taken" | "unknown";

/** After a start that did not serve, or a refusal, this long before the next try. */
const PAUSE_MS = 30_000;
/** D1's bound for a lease and for a sent batch's answer. */
const BOUND_MS = 10_000;

const data = workerData as RelayData | undefined;
if (parentPort !== null && data !== undefined) serve(data);

function serve(data: RelayData): void {
  const signal = new Int32Array(data.signal);
  let writer: DaemonWriter | null = null;
  let pauseUntil = 0;
  let spawnedAt = Number.NEGATIVE_INFINITY;
  let closing = false;

  const offFor = () => {
    writer = null;
    pauseUntil = Date.now() + PAUSE_MS;
  };
  const start = () => {
    if (data.launch === null || Date.now() - spawnedAt < PAUSE_MS) return;
    spawnedAt = Date.now();
    spawnStoreProcess(data.commonDir, data.launch, data.env);
  };
  const connect = async (): Promise<DaemonWriter | null> => {
    if (writer !== null) return writer;
    if (Date.now() < pauseUntil) return null;
    if (!existsSync(data.socketPath)) {
      start();
      return null;
    }
    const next = new DaemonWriter({
      worktreeId: data.worktreeId,
      storeSchema: data.storeSchema,
      socketPath: () => data.socketPath,
      holder: `${process.pid} daemon`,
      boundMs: BOUND_MS,
    });
    try {
      if (!(await next.acquire())) {
        start();
        return null;
      }
    } catch {
      return null;
    }
    writer = next;
    return writer;
  };
  const send = async (job: RelayJob): Promise<RelayOutcome> => {
    const connected = await connect();
    if (connected === null) return "not-taken";
    try {
      const queued = { kind: job.kind, splittable: job.splittable, seq: job.seq };
      if ((await connected.send(job.statements, false, queued)) === "written") return "written";
      offFor();
      return "not-taken";
    } catch {
      writer = null;
      return "unknown";
    }
  };

  // One batch at a time, in order: the store process keeps a worktree's batches in the order sent.
  let chain = Promise.resolve();
  data.port.on("message", (message: { readonly job?: RelayJob; readonly close?: true }) => {
    if (message.close === true) {
      closing = true;
      chain = chain.then(async () => {
        await writer?.release().catch(() => {});
        data.port.close();
      });
      return;
    }
    const job = message.job;
    if (job === undefined || closing) return;
    chain = chain.then(async () => {
      const outcome = await send(job);
      data.port.postMessage({ n: job.n, outcome });
      Atomics.add(signal, 0, 1);
      Atomics.notify(signal, 0);
    });
  });
}
