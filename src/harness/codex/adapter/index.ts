import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNTIME_ENTRY, RUNTIME_HOOKS, RuntimeError } from "./manifest.js";
import { usesSquealAt } from "./repository.js";
import { releaseSession, type SelectedRuntime, selectRuntime } from "./store.js";

/*
 * Spec 002 D7 and D9, `tasks/wave-4-contract.md`: the fixed plugin's hook
 * dispatcher. One allowed hook entry name, stdin read once, the session's
 * runtime selected (`selectRuntime`), and that runtime's `dist/runtime.mjs`
 * run in this process with the same input: no second Node start, no network.
 * The runtime sees its own root as `PLUGIN_ROOT` and the persistent
 * `PLUGIN_DATA`, so spec 005 D3's copies and launcher keep their meaning; the
 * fixed plugin's root stays in `SQUEAL_ADAPTER_ROOT`.
 */

export { RUNTIME_HOOKS as ADAPTER_HOOKS } from "./manifest.js";

/** The fixed plugin's root as the runtime sees it, beside its own `PLUGIN_ROOT`. */
export const ADAPTER_ROOT_ENV = "SQUEAL_ADAPTER_ROOT";

/** Hooks whose output can carry context for the model: where a diagnostic goes. */
const CONTEXT_EVENTS: Readonly<Record<string, string>> = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
  "subagent-start": "SubagentStart",
};

/** What the runtime module exports (`src/harness/codex/runtime-entry.ts`). */
interface RuntimeModule {
  readonly runRuntimeHook: (name: string, stdin: string, env: NodeJS.ProcessEnv) => Promise<void>;
}

export interface AdapterOptions {
  /** Default `process.env`; the runtime gets this object with its `PLUGIN_ROOT`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Default: read once from file descriptor 0. */
  readonly stdin?: string;
  /** Default: `process.stdout.write`. */
  readonly write?: (text: string) => void;
}

/**
 * Runs the hook `name` through the session's runtime. Exits nothing: a hook
 * process ends 0 with its output flushed (spec 002 D3). An unknown name, or
 * no `PLUGIN_ROOT` or `PLUGIN_DATA`, is silent. A runtime that cannot be
 * selected or loaded says so as context in a repository that uses Squeal, at
 * the hooks that carry context, and is silent elsewhere; it never runs
 * another version in its place.
 */
export async function runAdapterHook(name: string, options: AdapterOptions = {}): Promise<void> {
  if (!(RUNTIME_HOOKS as readonly string[]).includes(name)) return;
  const env = options.env ?? process.env;
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const stdin = options.stdin ?? readStdin();
  const pluginRoot = env.PLUGIN_ROOT ?? "";
  const data = env.PLUGIN_DATA ?? "";
  if (pluginRoot === "" || data === "") return;
  const input = fields(stdin);
  const inUse = input.cwd !== null && usesSquealAt(input.cwd);
  let runtime: SelectedRuntime;
  let module: RuntimeModule;
  try {
    // First valid contact pins: a session in a repository that uses Squeal.
    runtime = selectRuntime({ pluginRoot, data, sessionId: inUse ? input.sessionId : null });
    module = await load(runtime.root);
  } catch (error) {
    if (inUse) diagnose(name, error, write);
    debug(env, name, error);
    return;
  }
  env[ADAPTER_ROOT_ENV] = pluginRoot;
  env.PLUGIN_ROOT = runtime.root;
  try {
    await module.runRuntimeHook(name, stdin, env);
  } catch (error) {
    debug(env, name, error);
  }
  if (name === "session-end" && input.sessionId !== null) {
    try {
      releaseSession(data, input.sessionId);
    } catch (error) {
      debug(env, name, error);
    }
  }
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** The two fields the adapter reads; the runtime parses the rest. */
function fields(stdin: string): { sessionId: string | null; cwd: string | null } {
  try {
    const value: unknown = JSON.parse(stdin);
    if (typeof value !== "object" || value === null) return { sessionId: null, cwd: null };
    const { session_id, cwd } = value as { session_id?: unknown; cwd?: unknown };
    return {
      sessionId: typeof session_id === "string" && session_id !== "" ? session_id : null,
      cwd: typeof cwd === "string" && cwd !== "" ? cwd : null,
    };
  } catch {
    return { sessionId: null, cwd: null };
  }
}

async function load(root: string): Promise<RuntimeModule> {
  const entry = join(root, RUNTIME_ENTRY);
  let module: unknown;
  try {
    module = await import(pathToFileURL(entry).href);
  } catch (error) {
    throw new RuntimeError("invalid-runtime", `${entry} cannot be loaded: ${String(error)}`);
  }
  const run = (module as Partial<RuntimeModule>).runRuntimeHook;
  if (typeof run !== "function") {
    throw new RuntimeError("invalid-runtime", `${entry} exports no runRuntimeHook`);
  }
  return { runRuntimeHook: run };
}

/** The diagnostic text: validation is unavailable, why, and what to do. */
export function diagnosticText(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `SQUEAL · validation unavailable in this session. ${reason}\nSqueal reports no test results here until this is fixed: run the project's tests yourself meanwhile.`;
}

function diagnose(name: string, error: unknown, write: (text: string) => void): void {
  const event = CONTEXT_EVENTS[name];
  if (event === undefined) return;
  write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: diagnosticText(error) },
    }),
  );
}

function debug(env: NodeJS.ProcessEnv, name: string, error: unknown): void {
  if (env.SQUEAL_HOOK_DEBUG === "1") {
    process.stderr.write(`squeal codex adapter ${name}: ${String(error)}\n`);
  }
}
