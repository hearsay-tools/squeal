import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Spec 017 D3: the ESLint worker's script beside the running code. From a
 * bundled CLI at `<plugin>/dist/cli/`, `lint-worker.mjs` beside it; from
 * `tsc`'s build, `worker.js` beside this module. `null` from the TypeScript
 * sources: the provider is then off, since ESLint never runs in the
 * daemon's thread.
 */
export function lintWorkerScript(module: URL = new URL(import.meta.url)): string | null {
  for (const name of ["./worker.js", "./lint-worker.mjs"]) {
    const script = fileURLToPath(new URL(name, module));
    if (existsSync(script)) return script;
  }
  return null;
}
