import { leaseHolderOf } from "../core/delivery/daemon-writer.js";
import { openSentStore, type WriterFor } from "../core/delivery/sent-store.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { busyBackoffMs } from "../core/store/busy.js";
import { isBusy } from "../core/store/connection.js";
import { describeHolders, lockHolders } from "../core/store/lock-holders.js";
import { isStoreOpenFailure, openStore, setBusyTimeout } from "../core/store/open.js";
import { storePaths } from "../core/store/paths.js";
import { BUSY_BOUND_MS } from "../core/store/sliced-write.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS, daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { waitConsumer } from "./status-wait.js";

/*
 * The retry requests a command stores in the shared store: `squeal retry`'s
 * and, row 011-207 (011 C15), a named wait's one run of a file it names.
 */

/** How long a command keeps asking a busy store to take its requests (row 011-212, gh-86, 011 C13). */
export { BUSY_BOUND_MS };

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
  /** Spec 021 D15: who held the worktree's write lease the whole time, when that kept it. */
  readonly leaseHolder?: string;
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

/**
 * Spec 021 D1, D5: the words for a write the store refused until its bound:
 * how long the tries waited, and the process that holds the write lock where
 * the platform names it.
 */
export function busyText(commonDir: AbsolutePath, { busyMs, leaseHolder }: Busy): string {
  const after = `the store is busy after ${(busyMs / 1_000).toFixed(1)} s`;
  if (leaseHolder !== undefined) return `${after}, its write lease held by ${leaseHolder}`;
  return `${after}, ${describeHolders(lockHolders(storePaths(commonDir).database))}`;
}

/**
 * Spec 021 D15 (row 021-16): the store of `root`'s worktree, open for one
 * command's writes. While a daemon serves the worktree, they go to its
 * socket under the worktree's write lease and the daemon writes them in
 * its retried path; else they are written here, asked again while the
 * store is busy (`whileBusy`, D1).
 */
export interface CommandStore {
  readonly store: Store;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /**
   * `write`, one write transaction that reads its guards again, through the
   * daemon or here until `deadline`; past it, how long it waited.
   */
  write<T>(write: () => T, deadline: EpochMs): Promise<T | Busy>;
  close(): void;
}

export interface CommandStoreOptions {
  /** Create the store when it does not exist. Default `false`. */
  readonly create?: boolean;
  /** How long to keep asking a busy store or another holder of the lease. Default `BUSY_BOUND_MS`. */
  readonly boundMs?: number | undefined;
  /** Where the writes go while a daemon serves. Default its socket; a test gives its own. */
  readonly writer?: WriterFor;
}

/** `root`'s store for a command's writes; why not when it has none or it cannot be opened. */
export function openCommandStore(
  root: AbsolutePath,
  options: CommandStoreOptions = {},
): CommandStore | NotWritten {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return NO_STORE;
  const boundMs = options.boundMs ?? BUSY_BOUND_MS;
  const worktreeId = worktreeIdFor(root);
  const opened = openSentStore(commonDir, {
    worktreeId,
    create: options.create ?? false,
    busyTimeoutMs: Math.max(1, Math.min(CLI_SOCKET_TIMEOUT_MS, boundMs)),
    boundMs,
    holder: `${process.pid} squeal ${process.argv[2] ?? ""}`.trim(),
    ...(options.writer === undefined ? {} : { writer: options.writer }),
  });
  if ("reason" in opened) {
    if (opened.reason === "missing") return NO_STORE;
    return { not: "none", why: `its Squeal store could not be opened (${opened.reason})` };
  }
  const { store, connection } = opened;
  return {
    store,
    commonDir,
    worktreeId,
    write: async (write, deadline) => {
      const started = Date.now();
      try {
        return await opened.write(() =>
          connection.direct ? whileBusy(store, deadline, write) : write(),
        );
      } catch (error) {
        if (!isBusy(error)) throw error;
        const holder = leaseHolderOf(error);
        return {
          busyMs: Date.now() - started,
          ...(holder === null ? {} : { leaseHolder: holder }),
        };
      }
    },
    close: () => store.close(),
  };
}

/**
 * Why `writeWithin` wrote nothing: `none`, no store to write (or one that
 * cannot be opened), which a one-shot write leaves as it is; `busy`, another
 * process held the write lock until the bound; `failed`, the write threw.
 */
export interface NotWritten {
  readonly not: "none" | "busy" | "failed";
  readonly why: string;
}

export type Written<T> = { readonly wrote: T } | NotWritten;

const NO_STORE: NotWritten = { not: "none", why: "no Squeal daemon has run in this worktree" };

export type WriteWithinOptions = CommandStoreOptions;

/**
 * Spec 021 D1, D15: `write` over the store of `root`'s worktree, opened for
 * it and closed after (`openCommandStore`): through the serving daemon, or
 * here, asked again while another process holds the write lock, until the
 * bound. `write` is one write transaction that reads its guards again on
 * each try. A busy store at the open is not asked again: it only writes
 * there to migrate an older schema.
 */
export async function writeWithin<T>(
  root: AbsolutePath,
  write: (store: Store, id: WorktreeId) => T,
  options: WriteWithinOptions = {},
): Promise<Written<T>> {
  const started = Date.now();
  const boundMs = options.boundMs ?? BUSY_BOUND_MS;
  let commonDir: AbsolutePath | null = null;
  try {
    const opened = openCommandStore(root, options);
    if ("not" in opened) return opened;
    commonDir = opened.commonDir;
    let answer: T | Busy;
    try {
      answer = await opened.write(
        () => write(opened.store, opened.worktreeId),
        (started + boundMs) as EpochMs,
      );
    } finally {
      opened.close();
    }
    // The holder is named once this process holds no connection to the store (row 021-09's rule:
    // a descriptor of its files closed beside a connection drops that connection's locks).
    return isBusyWrite(answer)
      ? { not: "busy", why: busyText(commonDir, answer) }
      : { wrote: answer };
  } catch (error) {
    if (commonDir !== null && isBusy(error)) {
      return { not: "busy", why: busyText(commonDir, { busyMs: Date.now() - started }) };
    }
    return { not: "failed", why: error instanceof Error ? error.message : String(error) };
  }
}

/** Whether `answer` is a `Busy` a write returned, not the value it wrote. */
function isBusyWrite<T>(answer: T | Busy): answer is Busy {
  return typeof answer === "object" && answer !== null && isBusyAnswer(answer);
}

/** Tells the worktree's daemon to take the stored requests; whether one did. */
export async function tellDaemonRetries(root: AbsolutePath): Promise<boolean> {
  const response = await askDaemon(await daemonSocket(root), { type: "retry" }).catch(() => null);
  return response?.ok === true && response.type === "retry";
}
