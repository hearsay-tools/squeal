import type { EnsureDaemonOptions } from "../../core/daemon/ensure.js";
import { squealVersion } from "../../core/daemon/version.js";
import type {
  AbsolutePath,
  EnsureDaemonResult,
  EpochMs,
  HarnessProcess,
} from "../../core/types/index.js";
import {
  type ConsumerInput,
  type ContextOptions,
  type HookContext,
  type HookLocation,
  openContext,
} from "./context.js";
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
}

/** Every synchronous hook in hooks.json has `timeout: 2`; Claude Code kills it after this. */
export const HOOK_TIMEOUT_MS = 2_000;

/** Runs `fn` with an open store; `null` without one. Always closes the store. */
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
    ...overrides,
  };
  const context = openContext(input, location, options);
  if (context === null) return null;
  try {
    return await fn(context);
  } finally {
    context.close();
  }
}

/** Whether the consumer has a registration (never registered, unregistered and expired have none). */
export function isRegistered(context: HookContext): boolean {
  return context.store.consumers.get(context.consumer) !== null;
}
