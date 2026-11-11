import type { EnsureDaemonOptions } from "../../core/daemon/ensure.js";
import { squealVersion } from "../../core/daemon/version.js";
import type { AbsolutePath, EpochMs } from "../../core/types/common.js";
import type { EnsureDaemonResult } from "../../core/types/daemon.js";
import type { HarnessProcess } from "../../core/types/store-records.js";
import {
  type ConsumerInput,
  type ContextOptions,
  type HookContext,
  type HookLocation,
  openContext,
  type WriterFor,
} from "./context.js";
import type { HandOff } from "./hand-off.js";
import { findHarnessProcess } from "./harness-process.js";
import type { SessionRoots } from "./session-root.js";

export interface HookDeps {
  /** Environment of the hook process: `CLAUDE_CODE_*` variables decide whether the waiter runs. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Default: `ensureDaemon` from src/core/daemon. */
  readonly ensureDaemon?: (
    root: AbsolutePath,
    options: EnsureDaemonOptions & { readonly socketTimeoutMs: number },
  ) => Promise<EnsureDaemonResult>;
  /**
   * The CLI bundle a hook spawns as the daemon: `dist/cli/squeal.mjs` beside
   * the hook bundles (review wave 3, B1). `SQUEAL_CLI` overrides it.
   */
  readonly cli?: AbsolutePath;
  /**
   * How every text a hook gives the model names the CLI, a command the
   * agent's shell runs. Default `squeal`, on PATH under Claude Code; the Codex
   * hooks pass the installed CLI by its path (spec 002 D1 as amended).
   */
  readonly command?: string;
  /**
   * The epoch clock. Default `Date.now`. It must advance with real elapsed
   * time, at most a constant offset from `Date.now`: the waiting Stop entry
   * reads its process start in this frame, once, as `now() - performance.now()`
   * (task 001-326), so a frozen or independently advanced clock moves its
   * handoff cutoff (review wave 13bc S2).
   */
  readonly now?: () => EpochMs;
  /**
   * Row 019-14: the clock the waiting Stop entry measures its wait's bound
   * with, milliseconds from any origin that never go back. Default
   * `performance.now`. A test gives a faster one to pass a long bound.
   */
  readonly monotonicNow?: () => number;
  /** How long the idle waiter waits before it exits silently. Default `WAITER_TIMEOUT_MS`. */
  readonly waiterTimeoutMs?: number;
  /** Store polling interval of Stop's wait and the waiter. */
  readonly pollIntervalMs?: number;
  /**
   * The harness process a registration records (lessons, defect 24).
   * Default: `findHarnessProcess` from this hook's parent.
   */
  readonly harnessProcess?: () => HarnessProcess | null;
  /**
   * This hook's Squeal version: recorded with each registration and compared
   * with the daemon's (task 001-130, defect 26). Default `squealVersion()`.
   */
  readonly squealVersion?: string;
  /**
   * Where each session's root is kept between its hook processes, so every
   * hook of a session uses the root its SessionStart resolved (task
   * 001-405). The Claude Code and Codex bundles keep it in the runtime dir
   * (`sessionRootFiles`); without one, each hook locates its own `cwd`.
   */
  readonly sessionRoots?: SessionRoots;
  /**
   * Row 011-288: where `withContext` leaves the reports its deliveries
   * prepared, for the process wrapper to commit after the hand-off. Without
   * it, they commit when the hook's function returns.
   */
  readonly handOff?: HandOff;
  /**
   * Spec 021 D15 (row 021-16): where the writes go while a daemon serves
   * the worktree. Default: that daemon (`DaemonWriter`); a test gives its own.
   */
  readonly writer?: WriterFor;
}

/**
 * Runs `fn` with an open store; `null` without one. The reports its
 * deliveries prepared (row 011-288) go, with the store, to `deps.handOff`
 * when it is given; else they commit when `fn` returns. Each is abandoned
 * when `fn` throws. The store is closed, or left to the hand-off's end.
 */
export async function withContext<T>(
  input: ConsumerInput,
  location: HookLocation,
  deps: HookDeps,
  fn: (context: HookContext) => Promise<T | null>,
  overrides: Pick<ContextOptions, "busyTimeoutMs"> = {},
): Promise<T | null> {
  const options: ContextOptions = {
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.pollIntervalMs === undefined ? {} : { pollIntervalMs: deps.pollIntervalMs }),
    harnessProcess: deps.harnessProcess ?? (() => findHarnessProcess()),
    squealVersion: deps.squealVersion ?? squealVersion(),
    prepare: true,
    ...(deps.writer === undefined ? {} : { writer: deps.writer }),
    ...overrides,
  };
  const context = openContext(input, location, options);
  if (context === null) return null;
  let handed = false;
  try {
    const result = await fn(context);
    if (deps.handOff !== undefined && context.prepared?.pending === true) {
      deps.handOff.take(context.prepared, context.close, context.sent);
      handed = true;
    } else {
      context.prepared?.commit();
      // Spec 021 D15: a report's writes went to the daemon; it returns once they are written.
      await context.sent();
    }
    return result;
  } catch (error) {
    if (process.env.SQUEAL_DEBUG_CONTEXT) console.error("DEBUG withContext", error);
    context.prepared?.abandon();
    await context.sent().catch(() => {});
    throw error;
  } finally {
    if (!handed) context.close();
  }
}

/** Whether the consumer has a registration (never registered, unregistered and expired have none). */
export function isRegistered(context: HookContext): boolean {
  return context.store.consumers.get(context.consumer) !== null;
}
