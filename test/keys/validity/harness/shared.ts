import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isStoreOpenFailure, openStore } from "../../../../src/core/store/open.js";
import type { WorktreeId } from "../../../../src/core/types/common.js";
import type { CheckKey } from "../../../../src/core/types/keys.js";
import type { RunReport } from "../../../../src/core/types/runner.js";
import type { Store } from "../../../../src/core/types/store.js";
import type { Provenance, ResultRecord } from "../../../../src/core/types/store-records.js";

/* What the case kinds share: a store of the tree's own schema, a fixture worktree, a row's projections. */

/** Row 018-38: a run's log folder under a store that is not there, `<scratch>/gone/runs/<at>`. */
export const goneLogDir = (scratch: string, at: number) =>
  join(scratch, "gone", "runs", String(at));

export const KEY: CheckKey = "validity-key";

/** `KEY`'s file's key at a format read as one (011 C3 as amended 2026-10-20, task 011-38). */
export const LISTED_KEY: CheckKey = "validity-key-listed";

export const provenance = (worktree: string, recordedAt = 1_000, runId = "validity-run") =>
  ({
    worktreeId: worktree as WorktreeId,
    revision: 1,
    commit: null,
    dirty: false,
    runId,
    recordedAt,
  }) satisfies Provenance;

export const REPORT: RunReport = {
  end: "completed",
  durationMs: 50,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
};

/** A store of the tree's own schema under `dir`, migrated as a daemon opens one. */
export function scratchStore(dir: string): Store {
  mkdirSync(dir, { recursive: true });
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  return store;
}

/** Writes `files` under `root`, which is created; returns its real path. */
export function writeTree(root: string, files: Readonly<Record<string, string>>): string {
  mkdirSync(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return realpathSync(root);
}

/** Runs git in `root` with a fixed identity, as a fixture repository needs one. */
export function git(root: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=validity", "-c", "user.email=validity@example.com", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

/** A row as a decision reads it: identity, outcome, fingerprint (compared through `sameFingerprint`). */
export function verdictOf(row: ResultRecord) {
  return { check: row.check, outcome: row.outcome, fingerprint: row.fingerprint };
}

/** What a row carries for its reader and no decision reads. */
export function wordingOf(row: ResultRecord) {
  return {
    summary: row.summary,
    errors: row.errors,
    location: row.location,
    durationMs: row.durationMs,
  };
}
