import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDelivery } from "../../core/delivery/index.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../../core/fs/index.js";
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
  close(): void;
}

export interface ContextOptions {
  readonly now?: () => EpochMs;
  readonly pollIntervalMs?: number;
  /** How long a store statement waits for a lock. Default `STATUS_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
  /** The harness process a registration records (`DeliveryOptions.harnessProcess`). Default: none. */
  readonly harnessProcess?: () => HarnessProcess | null;
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
  const store = openStore(location.commonDir, {
    create: false,
    busyTimeoutMs: options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS,
  });
  if (isStoreOpenFailure(store)) return null;
  try {
    const consumer: Consumer = {
      worktreeId: worktreeIdFor(location.root),
      sessionId: input.session_id,
      agentId: input.agent_id ?? MAIN_AGENT,
    };
    const now = options.now ?? Date.now;
    const delivery = createDelivery(store, {
      status: createStatusBuilder(store, { now }),
      now,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.harnessProcess === undefined ? {} : { harnessProcess: options.harnessProcess }),
    });
    return { ...location, store, delivery, consumer, close: () => store.close() };
  } catch (error) {
    store.close();
    throw error;
  }
}
