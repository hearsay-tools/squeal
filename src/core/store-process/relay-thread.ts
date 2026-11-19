import { existsSync } from "node:fs";
import { type MessagePort, parentPort, workerData } from "node:worker_threads";
import { requestDaemon } from "../daemon/client.js";
import type { Statement } from "../daemon/write-batch.js";
import { DaemonWriter, SMALL_REQUEST_TIMEOUT_MS } from "../delivery/daemon-writer.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { WriteCancelResponse } from "../types/daemon-writes.js";
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
 * mark); surely not written there, as no store process serves (`none`), it
 * refused the batch (`refused`: another schema, a stopping process) or
 * rolled it back (`failed`); `unknown` sent and then lost, so only the mark
 * can tell.
 */
export type RelayOutcome = "written" | "none" | "refused" | "failed" | "unknown";

/** Where a cancelled batch stands (`WriteCancelResponse`), or `no-answer` from the store process. */
export type CancelState = WriteCancelResponse["state"] | "no-answer";

/** To the relay thread: a batch to send, one to cancel, or the end. */
export interface RelayMessage {
  readonly job?: RelayJob;
  readonly cancel?: { readonly n: number; readonly seq: string };
  readonly close?: true;
}

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
  /** Why the relay pauses: what each batch until `pauseUntil` is told. */
  let paused: "none" | "refused" = "none";
  let spawnedAt = Number.NEGATIVE_INFINITY;
  let closing = false;

  const offFor = (why: "none" | "refused") => {
    writer = null;
    paused = why;
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
    if (connected === null) return Date.now() < pauseUntil ? paused : "none";
    try {
      const queued = { kind: job.kind, splittable: job.splittable, seq: job.seq };
      if ((await connected.send(job.statements, false, queued)) === "written") return "written";
      const why = connected.notTakenBy ?? "none";
      // A rolled-back batch fails here too; a refusal or a store process gone is waited out.
      if (why === "failed") writer = null;
      else offFor(why);
      return why;
    } catch {
      writer = null;
      return "unknown";
    }
  };

  /** Review of 0.1.571: withdraws a batch the daemon gave up waiting for, or learns where it stands. */
  const cancel = async ({ n, seq }: { readonly n: number; readonly seq: string }) => {
    let state: CancelState = "no-answer";
    try {
      const request = { type: "write-cancel", worktreeId: data.worktreeId, seq } as const;
      const answer = await requestDaemon(data.socketPath, request, SMALL_REQUEST_TIMEOUT_MS);
      if (answer.ok && answer.type === "write-cancel") state = answer.state;
    } catch {
      // No answer: a store process gone or stopped; the mark settles the batch.
    }
    data.port.postMessage({ n, cancel: state });
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0);
  };

  // One batch at a time, in order: the store process keeps a worktree's batches in the order sent.
  let chain = Promise.resolve();
  data.port.on("message", (message: RelayMessage) => {
    if (message.cancel !== undefined) {
      // Not behind the batch it cancels: that one may wait on the store process for long.
      void cancel(message.cancel);
      return;
    }
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
