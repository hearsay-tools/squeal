import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type CodeSource, codeSource } from "../../core/delivery/code-source.js";
import { HoldingConnection } from "../../core/delivery/held-connection.js";
import { createDelivery } from "../../core/delivery/index.js";
import { PreparedReports } from "../../core/delivery/prepared.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../../core/fs/index.js";
import { type LintStoreSource, lintStoreSource } from "../../core/lint/surface/source.js";
import { createStatusBuilder, STATUS_BUSY_TIMEOUT_MS } from "../../core/status/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../core/store/index.js";
import {
  type AbsolutePath,
  type Consumer,
  type EpochMs,
  type HarnessDelivery,
  type HarnessProcess,
  MAIN_AGENT,
  type Store,
} from "../../core/types/index.js";

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
  close(): void;
}

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
   * the hand-off. Default `false`: each commits before it returns.
   */
  readonly prepare?: boolean;
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
  const holding = options.prepare === true ? holdingConnection() : null;
  const store = openStore(location.commonDir, {
    create: false,
    busyTimeoutMs: options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS,
    ...(holding === null ? {} : { connection: holding.make }),
  });
  if (isStoreOpenFailure(store)) return null;
  try {
    const consumer: Consumer = {
      worktreeId: worktreeIdFor(location.root),
      sessionId: input.session_id,
      agentId: input.agent_id ?? MAIN_AGENT,
    };
    const now = options.now ?? Date.now;
    const connection = holding?.made() ?? null;
    const prepare =
      connection === null ? undefined : { connection, reports: new PreparedReports() };
    // Spec 015 D6: read only while the worktree's `complexity.enabled` holds, in the hook's budget.
    const code = codeSource(location.commonDir, location.root, {
      busyTimeoutMs: options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS,
      holding: connection !== null,
    });
    // Spec 017 D8: read only while the worktree's `lint.enabled` holds, in the same budget.
    const lint = lintStoreSource(location.commonDir, location.root, {
      busyTimeoutMs: options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS,
    });
    const delivery = createDelivery(store, {
      status: createStatusBuilder(store, { now }),
      now,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.harnessProcess === undefined ? {} : { harnessProcess: options.harnessProcess }),
      ...(options.squealVersion === undefined ? {} : { squealVersion: options.squealVersion }),
      code,
      lint,
      ...(prepare === undefined ? {} : { prepare }),
    });
    const close = () => store.close();
    const prepared = prepare === undefined ? {} : { prepared: prepare.reports };
    return { ...location, store, delivery, consumer, code, lint, ...prepared, close };
  } catch (error) {
    store.close();
    throw error;
  }
}

/** An `openStore` `connection` option that keeps the `HoldingConnection` it made (row 011-288). */
function holdingConnection() {
  let made: HoldingConnection | null = null;
  return {
    make: (db: DatabaseSync) => {
      made = new HoldingConnection(db);
      return made;
    },
    made: () => made,
  };
}
