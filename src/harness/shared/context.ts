import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type CodeSource, codeLockFree, codeSource } from "../../core/delivery/code-source.js";
import { DaemonWriter } from "../../core/delivery/daemon-writer.js";
import { createDelivery } from "../../core/delivery/delivery.js";
import { PreparedReports } from "../../core/delivery/prepared.js";
import { SendingConnection } from "../../core/delivery/sending-connection.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../../core/fs/git-layout.js";
import { type LintStoreSource, lintStoreSource } from "../../core/lint/surface/source.js";
import { daemonLiveness } from "../../core/presence/heartbeat.js";
import { STATUS_BUSY_TIMEOUT_MS } from "../../core/status/open.js";
import { createStatusBuilder } from "../../core/status/snapshot.js";
import { isStoreOpenFailure, openStore } from "../../core/store/open.js";
import { storePaths } from "../../core/store/paths.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../core/types/common.js";
import { type Consumer, type HarnessDelivery, MAIN_AGENT } from "../../core/types/delivery.js";
import type { Store } from "../../core/types/store.js";
import type { HarnessProcess } from "../../core/types/store-records.js";

/**
 * The hook input fields that name a consumer. Claude Code and Codex both send
 * `session_id`, and `agent_id` for subagent events and events fired inside a
 * subagent.
 */
export interface ConsumerInput {
  readonly session_id: string;
  readonly agent_id?: string;
}

/** Where a hook runs: the worktree containing `cwd` and its git common dir. */
export interface HookLocation {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
}

/**
 * Spec 001 D1: the worktree is the nearest git top level of `cwd`; the common
 * dir is resolved without spawning git. `null` outside a worktree.
 */
export function locate(cwd: string): HookLocation | null {
  const root = findWorktreeRoot(cwd);
  if (root === null) return null;
  const commonDir = resolveCommonDir(root);
  return commonDir === null ? null : { root, commonDir };
}

/** True when the repository has a store or a `squeal.config.json`, so Squeal is in use. */
export function usesSqueal(location: HookLocation): boolean {
  return (
    existsSync(storePaths(location.commonDir).database) ||
    existsSync(join(location.root, "squeal.config.json"))
  );
}

export interface HookContext extends HookLocation {
  readonly store: Store;
  readonly delivery: HarnessDelivery;
  readonly consumer: Consumer;
  /** Spec 015: the code store as the delivery reads it; absent in contexts made without one. */
  readonly code?: CodeSource;
  /** Spec 017 D8: the lint store as the delivery reads it; absent in contexts made without one. */
  readonly lint?: LintStoreSource;
  /** Row 011-288: the reports its deliveries prepared, with `ContextOptions.prepare`. */
  readonly prepared?: PreparedReports;
  /**
   * Spec 021 D15 (row 021-16): runs `work`, which may write the store. While
   * a daemon serves the worktree, its writes go to the daemon under the
   * worktree's write lease (`SendingConnection.unit`), and this resolves once
   * they are written; else they are written here. Every write a hook makes
   * outside its delivery's methods runs in one.
   */
  write<T>(work: () => T | Promise<T>): Promise<T>;
  /** Waits until every batch this context sent, its reports' included, is written. */
  sent(): Promise<void>;
  close(): void;
}

/**
 * Spec 021 D15: where a context's writes go while a daemon serves, as
 * `SendingConnection` needs it. Default: the daemon the store records for
 * the worktree (`DaemonWriter`).
 */
export type WriterFor = (target: WriterTarget) => SenderWithLease;

export interface WriterTarget {
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
  /** The socket the store records for the worktree's daemon; `null` when none. */
  readonly socketPath: () => AbsolutePath | null;
  /** How long a lease waits for another holder, and a write for its answer. */
  readonly boundMs: number;
}

/** A sender, with the lease's `acquire` (`DaemonWriter`). */
export type SenderWithLease = ConstructorParameters<typeof SendingConnection>[1] & {
  acquire(): Promise<boolean>;
};

export interface ContextOptions {
  readonly now?: () => EpochMs;
  readonly pollIntervalMs?: number;
  /** How long a store statement waits for a lock. Default `STATUS_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
  /** The harness process a registration records (`DeliveryOptions.harnessProcess`). Default: none. */
  readonly harnessProcess?: () => HarnessProcess | null;
  /** The hook's Squeal version a registration records (`DeliveryOptions.squealVersion`). Default: none. */
  readonly squealVersion?: string;
  /**
   * Row 011-288: each delivery that tells something leaves its transaction
   * open, its report in `HookContext.prepared` for the hook to commit after
   * the hand-off. Default `false`: each commits before it returns. Spec 021
   * D15: with it, the writes go to the serving daemon (`ContextOptions.writer`).
   */
  readonly prepare?: boolean;
  /** Where the writes go while a daemon serves, with `prepare`. Default `DaemonWriter`. */
  readonly writer?: WriterFor;
}

/**
 * Opens the store read-write for one hook call. `null` when there is no store
 * or it cannot be opened (newer schema, corrupt): hooks then stay silent.
 * Spec 001 D9 consumer: `(worktree, session id, agent id or "main")`.
 */
export function openContext(
  input: ConsumerInput,
  location: HookLocation,
  options: ContextOptions = {},
): HookContext | null {
  const worktreeId = worktreeIdFor(location.root);
  const busyTimeoutMs = options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS;
  let opened: Store | null = null;
  const holding =
    options.prepare === true
      ? sendingConnection(options.writer ?? daemonWriter, {
          worktreeId,
          boundMs: busyTimeoutMs,
          socketPath: () => opened?.worktrees.get(worktreeId)?.daemon?.socketPath ?? null,
        })
      : null;
  const store = openStore(location.commonDir, {
    create: false,
    busyTimeoutMs,
    ...(holding === null ? {} : { connection: holding.make }),
  });
  if (isStoreOpenFailure(store)) return null;
  opened = store;
  try {
    const consumer: Consumer = {
      worktreeId,
      sessionId: input.session_id,
      agentId: input.agent_id ?? MAIN_AGENT,
    };
    const now = options.now ?? Date.now;
    const { connection, write, sent } = contextWrites(holding, store, worktreeId, now());
    // Spec 015 D6: read only while the worktree's `complexity.enabled` holds, in the hook's budget.
    const code = codeSource(location.commonDir, location.root, {
      busyTimeoutMs,
      holding: connection !== null,
    });
    // Spec 021 D3: the code store's lock is waited for before the store is held, never inside.
    const prepare =
      connection === null
        ? undefined
        : {
            connection,
            reports: new PreparedReports(),
            beforeHold: () => codeLockFree(code),
            unit: write,
          };
    // Spec 017 D8: read only while the worktree's `lint.enabled` holds, in the same budget.
    const lint = lintStoreSource(location.commonDir, location.root, { busyTimeoutMs });
    const delivery = createDelivery(store, {
      status: createStatusBuilder(store, { now }),
      now,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.harnessProcess === undefined ? {} : { harnessProcess: options.harnessProcess }),
      ...(options.squealVersion === undefined ? {} : { squealVersion: options.squealVersion }),
      code,
      lint,
      ...(prepare === undefined ? {} : { prepare }),
      // Row 011-312: a registration records the commit `HEAD` names here.
      root: location.root,
    });
    const close = () => store.close();
    const prepared = prepare === undefined ? {} : { prepared: prepare.reports };
    return { ...location, store, delivery, consumer, code, lint, ...prepared, write, sent, close };
  } catch (error) {
    store.close();
    throw error;
  }
}

/**
 * A context's `write` and `sent` over the connection `holding` made. Spec
 * 021 D15: only a daemon whose heartbeat is fresh serves the worktree; with
 * none, or one whose main thread lags (it would write the batches late),
 * they are written here from the start.
 */
function contextWrites(
  holding: ReturnType<typeof sendingConnection> | null,
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
) {
  const connection = holding?.made() ?? null;
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (connection !== null && daemonLiveness(record, now).state !== "alive") {
    connection.writeDirectly();
  }
  return {
    connection,
    write: <T>(work: () => T | Promise<T>): Promise<T> =>
      connection === null || holding === null
        ? Promise.resolve().then(work)
        : connection.unit(work, holding.acquire),
    sent: () => connection?.sent() ?? Promise.resolve(),
  };
}

/** The default `WriterFor`: the daemon the store records (`DaemonWriter`). */
const daemonWriter: WriterFor = (target) =>
  new DaemonWriter({ ...target, holder: `${process.pid} ${process.argv[1] ?? "hook"}` });

/**
 * An `openStore` `connection` option that keeps the `SendingConnection` it
 * made (row 011-288, spec 021 D15), with the writer its writes go to.
 */
function sendingConnection(writer: WriterFor, target: Omit<WriterTarget, "storeSchema">) {
  let made: SendingConnection | null = null;
  let sender: SenderWithLease | null = null;
  return {
    make: (db: DatabaseSync) => {
      const storeSchema = Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0]);
      sender = writer({ ...target, storeSchema });
      made = new SendingConnection(db, sender);
      return made;
    },
    made: () => made,
    acquire: () => sender?.acquire() ?? Promise.resolve(false),
  };
}
