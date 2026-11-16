import { compare } from "../core/fs/compare.js";

/*
 * Spec 023 D4.4, D5.3 (row 023-04, review wave 1 B2): the one environment
 * of a `runGateFiles` call. The stores key with it, and the runners'
 * config loading, a node:test `prepare`, Vitest in this process and its
 * workers, and node:test's processes run under it. They all read
 * `process.env`, so the call holds `process.env` at that environment and
 * restores it after; while it does, no other call runs.
 */

/** What a call asks for: its own environment, its own `TMPDIR`, or neither. */
export interface CallEnvironment {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly tempDir?: string | undefined;
}

/**
 * The environment the call runs under: `env`, else this process's, with
 * `TMPDIR` at `tempDir` when given; `null` when the call asks for neither,
 * so it runs under `process.env` as it is.
 */
export function effectiveEnvironment(call: CallEnvironment): NodeJS.ProcessEnv | null {
  if (call.env === undefined && call.tempDir === undefined) return null;
  const env: NodeJS.ProcessEnv = { ...(call.env ?? process.env) };
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  if (call.tempDir !== undefined) env.TMPDIR = call.tempDir;
  return env;
}

/**
 * D5.3: the variables `env` sets otherwise than `base`, unset included,
 * that no name of `allowlist` keys, `TMPDIR` aside (the call's own
 * folders, D4.4); sorted. A run under such a condition is not what its
 * key stands for, so it must not store.
 */
export function conditionsOutsideKey(
  env: NodeJS.ProcessEnv,
  base: NodeJS.ProcessEnv,
  allowlist: readonly string[],
): string[] {
  const keyed = new Set([...allowlist, "TMPDIR"]);
  const names = new Set([...Object.keys(env), ...Object.keys(base)]);
  return [...names].filter((name) => !keyed.has(name) && env[name] !== base[name]).sort(compare);
}

/** Calls running now, and whether one of them holds `process.env`. */
let running = 0;
let held = false;

/**
 * `run` with `process.env` holding exactly `env`, restored exactly after
 * it; with `env` `null`, `process.env` as it is. Rejects without running
 * when `env` is given while another call runs, or when another call holds
 * `process.env`: the two would see each other's environment.
 */
export async function withEnvironment<T>(
  env: NodeJS.ProcessEnv | null,
  run: () => Promise<T>,
): Promise<T> {
  if (held || (env !== null && running > 0)) {
    throw new Error("runGateFiles: another call runs in this process with its own environment");
  }
  running += 1;
  const saved = env === null ? null : { ...process.env };
  if (env !== null) {
    held = true;
    replace(env);
  }
  try {
    return await run();
  } finally {
    if (saved !== null) {
      replace(saved);
      held = false;
    }
    running -= 1;
  }
}

/** `process.env` made to hold exactly `env`'s variables. */
function replace(env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
