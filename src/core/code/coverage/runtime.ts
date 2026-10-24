import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AbsolutePath, CheckKey, Policy, Store, WorktreeId } from "../../types/index.js";
import type { ResultKeyOf } from "./types.js";

/** The provider's file name, beside this module and in a plugin's `dist/coverage/`. */
export const PROVIDER_FILE = "provider.mjs";

/**
 * Where Squeal's coverage provider sits relative to `module`, the running
 * code's own file: from a bundled CLI at `<plugin>/dist/cli/`, the plugin's
 * `dist/coverage/`; from the TypeScript sources, beside this file. `null`
 * when neither holds it.
 */
const CANDIDATES = ["../coverage/", "./coverage/", "./"] as const;

export function coverageProvider(module: URL = new URL(import.meta.url)): AbsolutePath | null {
  for (const candidate of CANDIDATES) {
    const provider = fileURLToPath(new URL(`${candidate}${PROVIDER_FILE}`, module));
    if (existsSync(provider)) return provider;
  }
  return null;
}

/** Spec 015 D8: noted when coverage is on and no provider is beside the running code. */
export const PROVIDER_MISSING_NOTE =
  "coverage stays off: Squeal's coverage provider (coverage/provider.mjs) is not beside its code (spec 015 D8)";

/** Spec 015 D1: `coverage.enabled` acts only with `complexity.enabled`. */
export function coverageOn(policy: Pick<Policy, "complexity" | "coverage">): boolean {
  return policy.coverage.enabled && policy.complexity.enabled;
}

/**
 * The key the run `runId`'s results of a test file were stored under, read
 * from the worktree's main store: its current key, while a result there
 * names that run. `undefined` before the scheduler stored them, and once an
 * edit re-keyed the file first (its record then waits for no result).
 */
export function mainStoreResultKey(
  store: Pick<Store, "testFileKeys" | "results">,
  worktreeId: WorktreeId,
): ResultKeyOf {
  return (runId, testFile) => {
    const key: CheckKey | null | undefined = store.testFileKeys.list(worktreeId, [testFile])[0]
      ?.key;
    if (key === null || key === undefined) return undefined;
    const stored = store.results
      .byKey(key, 0)
      .some(
        (r) =>
          r.provenance.runId === runId &&
          r.check.project === testFile.project &&
          r.check.testPath === testFile.path,
      );
    return stored ? key : undefined;
  };
}
