import type { AbsolutePath, EnsureDaemonResult, EpochMs } from "../../core/types/index.js";
import {
  type ContextOptions,
  type HookContext,
  type HookLocation,
  openContext,
} from "./context.js";
import type { HookInput } from "./input.js";

export interface HookDeps {
  /** Environment of the hook process: `CLAUDE_CODE_*` variables decide whether the waiter runs. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Default: `ensureDaemon` from src/core/daemon. */
  readonly ensureDaemon?: (
    root: AbsolutePath,
    options: { readonly socketTimeoutMs: number },
  ) => Promise<EnsureDaemonResult>;
  readonly now?: () => EpochMs;
  /** How long the idle waiter waits before it exits silently. Default `WAITER_TIMEOUT_MS`. */
  readonly waiterTimeoutMs?: number;
  /** Store polling interval of Stop's wait and the waiter. */
  readonly pollIntervalMs?: number;
}

/** What a handler wants written. `null` from a handler means: no output, exit 0. */
export interface HookOutcome {
  /** One JSON object on stdout. */
  readonly output?: object;
  readonly stderr?: string;
  readonly exitCode?: 0 | 2;
}

export type Handler = (
  input: HookInput,
  location: HookLocation,
  deps: HookDeps,
) => Promise<HookOutcome | null>;

/** Runs `fn` with an open store; `null` without one. Always closes the store. */
export async function withContext(
  input: HookInput,
  location: HookLocation,
  deps: HookDeps,
  fn: (context: HookContext) => Promise<HookOutcome | null>,
): Promise<HookOutcome | null> {
  const options: ContextOptions = {
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.pollIntervalMs === undefined ? {} : { pollIntervalMs: deps.pollIntervalMs }),
  };
  const context = openContext(input, location, options);
  if (context === null) return null;
  try {
    return await fn(context);
  } finally {
    context.close();
  }
}

/** `hookSpecificOutput.additionalContext` for the event that fired. */
export function additionalContext(input: HookInput, text: string): HookOutcome {
  return {
    output: {
      hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: text },
    },
  };
}

/** Whether the consumer has a registration (never registered, unregistered and expired have none). */
export function isRegistered(context: HookContext): boolean {
  return context.store.consumers.get(context.consumer) !== null;
}
