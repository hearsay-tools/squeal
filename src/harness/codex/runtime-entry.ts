import { CODEX_HOOKS, type CodexHookName } from "./hooks.js";
import { runHookInput } from "./main.js";

/*
 * Spec 002 D7 to D9, `tasks/wave-4-contract.md`: the runtime's dispatch entry,
 * bundled as `dist/runtime.mjs` beside the ten hook entries. The fixed
 * plugin's adapter imports it in the hook's own process and calls
 * `runRuntimeHook` with the stdin it read; importing it runs nothing.
 */

/**
 * Runs the Codex hook `name` on `stdin` in `env` as its bundled entry does
 * (`runMain`): the same handler, output and silence on any error. A name that
 * is no Codex hook is silent.
 */
export function runRuntimeHook(name: string, stdin: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (!Object.hasOwn(CODEX_HOOKS, name)) return Promise.resolve();
  return runHookInput(name, CODEX_HOOKS[name as CodexHookName], stdin, env);
}
