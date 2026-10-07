import type { HookLocation } from "../shared/context.js";
import type { HookDeps } from "../shared/hook.js";
import type { HookInput } from "./input.js";

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

/** `hookSpecificOutput.additionalContext` for the event that fired. */
export function additionalContext(input: HookInput, text: string): HookOutcome {
  return {
    output: {
      hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: text },
    },
  };
}
