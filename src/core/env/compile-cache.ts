/*
 * Spec 025 D7.2: the shell hook runners and CLI launchers point Node's compile
 * cache at Squeal's own directory when the user set none, and mark it with
 * `SQUEAL_OWN_COMPILE_CACHE=1`. The daemon inherits both and starts faster.
 * A user's test process must not: it would write the project's modules into
 * Squeal's cache and see a variable the user never set. A `NODE_COMPILE_CACHE`
 * without the mark is the user's own, and it stays.
 */

/** Node's compile cache directory switch. */
export const COMPILE_CACHE = "NODE_COMPILE_CACHE";
/** `"1"` when Squeal's launcher set `COMPILE_CACHE`, not the user. */
export const OWN_COMPILE_CACHE = "SQUEAL_OWN_COMPILE_CACHE";

/** True when `env`'s compile cache is the one Squeal's launcher set. */
export function hasOwnCompileCache(env: NodeJS.ProcessEnv): boolean {
  return env[OWN_COMPILE_CACHE] === "1";
}

/**
 * `env` for a user's test process: a copy without `NODE_COMPILE_CACHE` and
 * `SQUEAL_OWN_COMPILE_CACHE` when the cache is Squeal's own, else `env`
 * itself, so a user-set cache reaches the tests unchanged.
 */
export function withoutOwnCompileCache(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!hasOwnCompileCache(env)) return env;
  const { [COMPILE_CACHE]: _cache, [OWN_COMPILE_CACHE]: _own, ...rest } = env;
  return rest;
}

/**
 * Takes Squeal's own compile cache out of `env` in place, for a process whose
 * children inherit `env` as it is at their spawn (Vitest's workers spread
 * `process.env`). This process keeps the cache Node enabled at its start.
 */
export function dropOwnCompileCache(env: NodeJS.ProcessEnv = process.env): void {
  if (!hasOwnCompileCache(env)) return;
  Reflect.deleteProperty(env, COMPILE_CACHE);
  Reflect.deleteProperty(env, OWN_COMPILE_CACHE);
}
