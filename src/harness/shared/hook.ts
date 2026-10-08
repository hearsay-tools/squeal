import type { EnsureDaemonOptions } from "../../core/daemon/ensure.js";
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
  readonly now?: () => EpochMs;
  /** How long the idle waiter waits before it exits silently. Default `WAITER_TIMEOUT_MS`. */
  readonly waiterTimeoutMs?: number;
  /** Store polling interval of Stop's wait and the waiter. */
  readonly pollIntervalMs?: number;
  /**
   * The harness process a registration records (lessons, defect 24).
   * Default: `findHarnessProcess` from this hook's parent and `env`.
   */
  readonly harnessProcess?: () => HarnessProcess | null;
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
    harnessProcess: deps.harnessProcess ?? (() => findHarnessProcess({ env: deps.env })),
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
