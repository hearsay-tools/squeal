import { resolveCommonDir } from "../core/fs/index.js";
import {
  busyBackoffMs,
  isBusy,
  isStoreOpenFailure,
  openStore,
  setBusyTimeout,
} from "../core/store/index.js";
import type { AbsolutePath, EpochMs, Store } from "../core/types/index.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS, daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { waitConsumer } from "./status-wait.js";

/*
 * The retry requests a command stores in the shared store: `squeal retry`'s
 * and, row 011-207 (011 C15), a named wait's one run of a file it names.
 */

/**
 * How long a command keeps asking a busy store to take its requests before
 * it says another process holds it (row 011-212, gh-86, 011 C13).
 */
export const BUSY_BOUND_MS = 10_000;

/** The shared store of `root`'s worktree, open for the command's writes; `null` when it has none. */
export function openForWrites(root: AbsolutePath): Store | null {
  const commonDir = resolveCommonDir(root);
  const store =
    commonDir === null
      ? null
      : openStore(commonDir, { create: false, busyTimeoutMs: CLI_SOCKET_TIMEOUT_MS });
  return store === null || isStoreOpenFailure(store) ? null : store;
}

/** The harness session the shell runs in; `""` when it names none. */
export function sessionOf(io: CliIo): string {
  const env = io.env ?? process.env;
  const pi = env.PI_SESSION_ID === "" ? undefined : env.PI_SESSION_ID;
  return waitConsumer(env).session ?? pi ?? "";
}

/** A write the store refused until the bound: how long this file's tries waited. */
export interface Busy {
  readonly busyMs: number;
}

/**
 * `write`'s answer, run again while another process holds the store's write
 * lock (row 011-212, gh-86): a refused `BEGIN IMMEDIATE` writes nothing and
 * each try reads its `spent` or `joined` guard again, so a request is stored
 * once. Each try's busy timeout ends by `deadline`, with `busyBackoffMs`
 * between tries; at the deadline, how long the tries waited.
 */
export function whileBusy<T>(store: Store, deadline: EpochMs, write: () => T): T | Busy {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    setBusyTimeout(store, Math.max(1, Math.min(CLI_SOCKET_TIMEOUT_MS, deadline - Date.now())));
    try {
      return write();
    } catch (error) {
      if (!isBusy(error)) throw error;
    } finally {
      setBusyTimeout(store, CLI_SOCKET_TIMEOUT_MS);
    }
    const pause = busyBackoffMs(attempt);
    if (Date.now() + pause >= deadline) return { busyMs: Date.now() - started };
    Atomics.wait(SLEEP, 0, 0, pause);
  }
}

const SLEEP = new Int32Array(new SharedArrayBuffer(4));

export const isBusyAnswer = (answer: object): answer is Busy => "busyMs" in answer;

/** Tells the worktree's daemon to take the stored requests; whether one did. */
export async function tellDaemonRetries(root: AbsolutePath): Promise<boolean> {
  const response = await askDaemon(await daemonSocket(root), { type: "retry" }).catch(() => null);
  return response?.ok === true && response.type === "retry";
}
