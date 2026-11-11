import { existsSync } from "node:fs";
import { join } from "node:path";
import { type CodeSource, codeLockFree, codeSource } from "../../core/delivery/code-source.js";
import { createDelivery } from "../../core/delivery/delivery.js";
import { PreparedReports } from "../../core/delivery/prepared.js";
import { openSentStore, type WriterFor } from "../../core/delivery/sent-store.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../../core/fs/git-layout.js";
import { type LintStoreSource, lintStoreSource } from "../../core/lint/surface/source.js";
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

export type { WriterFor };

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
  const now = options.now ?? Date.now;
  const opened = open(location, worktreeId, options, busyTimeoutMs, now);
  if (opened === null) return null;
  const { store, connection, write } = opened;
  try {
    const consumer: Consumer = {
      worktreeId,
      sessionId: input.session_id,
      agentId: input.agent_id ?? MAIN_AGENT,
    };
    const sent = () => connection?.sent() ?? Promise.resolve();
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
 * The store of one hook call. Row 011-288, spec 021 D15: with `prepare`,
 * its connection is a `SendingConnection`, whose writes go to the daemon
 * that serves the worktree (`openSentStore`); without, a plain one that
 * writes here.
 */
function open(
  location: HookLocation,
  worktreeId: WorktreeId,
  options: ContextOptions,
  busyTimeoutMs: number,
  now: () => EpochMs,
) {
  if (options.prepare !== true) {
    const store = openStore(location.commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(store)) return null;
    const write = <T>(work: () => T | Promise<T>) => Promise.resolve().then(work);
    return { store, connection: null, write };
  }
  const sent = openSentStore(location.commonDir, {
    worktreeId,
    busyTimeoutMs,
    boundMs: busyTimeoutMs,
    holder: `${process.pid} ${process.argv[1] ?? "hook"}`,
    now,
    ...(options.writer === undefined ? {} : { writer: options.writer }),
  });
  return "reason" in sent ? null : sent;
}
