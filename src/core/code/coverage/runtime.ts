import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testFileId } from "../../keys/reverse-index.js";
import { readUnknownFiles } from "../../scheduler/unknown-files.js";
import type { AbsolutePath, WorktreeId } from "../../types/common.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { Policy } from "../../types/policy.js";
import type { Store } from "../../types/store.js";
import type { ResultRecord } from "../../types/store-records.js";
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

/**
 * Row 015-75: the runners whose runs give coverage records (D8), by the name
 * their environment gives (`RunnerEnvironment.runnerName`). A test file of
 * any other runner gives none, so the sources it loads read `unknown` at
 * once. The one place that decides it; node:test from row 015-86.
 */
export const RECORDING_RUNNERS: ReadonlySet<string> = new Set(["vitest", "node-test"]);

/**
 * Rows 015-75 and 015-86: the runners whose environment files run in each
 * test file's own process (a node:test preload's closure, pytest's plugins),
 * so each counts as loaded by each of the project's test files. A Vitest
 * environment holds its config, which runs outside the workers.
 */
export const IN_PROCESS_ENVIRONMENTS: ReadonlySet<string> = new Set(["node-test", "pytest"]);

/** Spec 015 D1: `coverage.enabled` acts only with `complexity.enabled`. */
export function coverageOn(policy: Pick<Policy, "complexity" | "coverage">): boolean {
  return policy.coverage.enabled && policy.complexity.enabled;
}

/**
 * The key the run `runId`'s results of a test file were stored under, read
 * from the worktree's main store: its current key, while a result there
 * names that run. `undefined` before the scheduler stored them, and once an
 * edit re-keyed the file first (its record then waits for no result).
 *
 * Review 0.1.620 S3 (spec 026 D10): a run on another machine than the one
 * the file's key is for is stored only under that machine's key, and the
 * file is `unknown` at its current key (`storeOtherMachine`). Its key is
 * then the one its results were stored under, while the file is still
 * `unknown` at the key it ran for after a completed run, and this
 * worktree's results of that run are the file's newest. No other key is
 * given: a record never makes a result key, nor another machine's current.
 */
export function mainStoreResultKey(store: Store, worktreeId: WorktreeId): ResultKeyOf {
  return (runId, testFile) => {
    const key: CheckKey | null | undefined = store.testFileKeys.list(worktreeId, [testFile])[0]
      ?.key;
    if (key === null || key === undefined) return undefined;
    if (store.results.byKey(key, 0).some((r) => ranFile(r, runId, testFile))) return key;
    return otherMachineKey(store, worktreeId, runId, testFile, key);
  };
}

/** Whether `result` is of `testFile`, from the run `runId`. */
function ranFile(result: ResultRecord, runId: string, testFile: TestFileRef): boolean {
  return (
    result.provenance.runId === runId &&
    result.check.project === testFile.project &&
    result.check.testPath === testFile.path
  );
}

/** S3: the key `runId` stored `testFile` under on another machine than `current`'s; else `undefined`. */
function otherMachineKey(
  store: Store,
  worktreeId: WorktreeId,
  runId: string,
  testFile: TestFileRef,
  current: CheckKey,
): CheckKey | undefined {
  const unknown = readUnknownFiles(store, worktreeId).get(testFileId(testFile));
  // Edit protection: still at the key the run was for, which it left `unknown` after it ran.
  if (unknown === undefined || !unknown.ran || unknown.key !== current) return undefined;
  const newest = store.results.newestForTestFile(testFile);
  const stored = newest[0]?.key;
  if (stored === undefined || stored === current) return undefined;
  const ours = newest.some(
    (r) => r.provenance.worktreeId === worktreeId && ranFile(r, runId, testFile),
  );
  return ours ? stored : undefined;
}
