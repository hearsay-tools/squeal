import type { DatabaseSync } from "node:sqlite";
import { daemonLiveness } from "../presence/heartbeat.js";
import { isStoreOpenFailure, openStore } from "../store/open.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../types/common.js";
import type { Store, StoreOpenFailure } from "../types/store.js";
import { DaemonWriter } from "./daemon-writer.js";
import { SendingConnection, type WriteSender } from "./sending-connection.js";

/*
 * Spec 021 D15 (row 021-16): a hook's or a command's store, opened so its
 * writes go to the daemon that serves the worktree (`SendingConnection`,
 * `DaemonWriter`), or are written here when none does.
 */

/** A sender, with the lease's `acquire` (`DaemonWriter`). */
export type SenderWithLease = WriteSender & { acquire(): Promise<boolean> };

/** What a sender is made for (`WriterFor`). */
export interface WriterTarget {
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
  /** The socket the store records for the worktree's daemon; `null` when none. */
  readonly socketPath: () => AbsolutePath | null;
  /** How long a lease waits for another holder, and a write for its answer. */
  readonly boundMs: number;
}

/** Where the writes go while a daemon serves. Default `DaemonWriter`; a test gives its own. */
export type WriterFor = (target: WriterTarget) => SenderWithLease;

export interface SentStoreOptions {
  readonly worktreeId: WorktreeId;
  readonly create?: boolean;
  readonly busyTimeoutMs: number;
  /** How long a lease waits for another holder, and a write for its answer. */
  readonly boundMs: number;
  /** Who writes, as the daemon names a lease's holder. */
  readonly holder: string;
  readonly writer?: WriterFor;
  readonly now?: () => EpochMs;
}

export interface SentStore {
  readonly store: Store;
  readonly connection: SendingConnection;
  /**
   * Runs `work`, whose writes go to the serving daemon under the worktree's
   * write lease, and resolves once they are written (`SendingConnection.unit`);
   * else they are written here.
   */
  write<T>(work: () => T | Promise<T>): Promise<T>;
}

/**
 * Opens the store at `commonDir` for one hook or command. Only a daemon
 * whose heartbeat is fresh serves the worktree; with none, or one whose
 * main thread lags (it would write the batches late), the writes are made
 * here from the start, as before this spec.
 */
export function openSentStore(
  commonDir: AbsolutePath,
  options: SentStoreOptions,
): SentStore | StoreOpenFailure {
  const { worktreeId, boundMs, holder } = options;
  let opened: Store | null = null;
  let made: SendingConnection | null = null;
  let sender: SenderWithLease | null = null;
  const writer = options.writer ?? ((target) => new DaemonWriter({ ...target, holder }));
  const store = openStore(commonDir, {
    create: options.create ?? false,
    busyTimeoutMs: options.busyTimeoutMs,
    connection: (db: DatabaseSync) => {
      sender = writer({
        worktreeId,
        boundMs,
        storeSchema: Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0]),
        socketPath: () => opened?.worktrees.get(worktreeId)?.daemon?.socketPath ?? null,
      });
      made = new SendingConnection(db, sender);
      return made;
    },
  });
  if (isStoreOpenFailure(store)) return store;
  opened = store;
  const connection = made as SendingConnection | null;
  if (connection === null) throw new Error("squeal: the store opened without its connection");
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  const now = (options.now ?? Date.now)();
  if (daemonLiveness(record, now).state !== "alive") connection.writeDirectly();
  const acquire = () => (sender as SenderWithLease | null)?.acquire() ?? Promise.resolve(false);
  return { store, connection, write: (work) => connection.unit(work, acquire) };
}
