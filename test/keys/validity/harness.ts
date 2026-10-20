import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLOSURE_METHOD, checkKey, environmentHash } from "../../../src/core/keys/index.js";
import { recordsForFile } from "../../../src/core/scheduler/records.js";
import { describeFailure } from "../../../src/core/state/fingerprint.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import type {
  CheckKey,
  Provenance,
  ResultRecord,
  RunReport,
  Store,
  WorktreeId,
} from "../../../src/core/types/index.js";
import type { Case, CaseOutput, KeyInput, RowsInput } from "./case.js";

/*
 * One function per case kind (task 011-37 section 3). Bundled once against
 * each tree: every `src/` import below resolves into the tree under test, so
 * these lines are the same at both and only the tree's code differs. A tree
 * that moves a function is read at the new path, the old one kept for the
 * last release until it carries the move.
 */

const KEY: CheckKey = "validity-key";

const PROVENANCE: Provenance = {
  worktreeId: "validity-a" as WorktreeId,
  revision: 1,
  commit: null,
  dirty: false,
  runId: "validity-run",
  recordedAt: 1_000,
};

const REPORT: RunReport = {
  end: "completed",
  durationMs: 50,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
};

/** A store of the tree's own schema in `dir`. */
export function scratchStore(dir: string): Store {
  mkdirSync(dir, { recursive: true });
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  return store;
}

/** A row as a decision reads it: identity, outcome, fingerprint (compared through `sameFingerprint`). */
function verdictOf(row: ResultRecord) {
  return { check: row.check, outcome: row.outcome, fingerprint: row.fingerprint };
}

/** What a row carries for its reader and no decision reads. */
function wordingOf(row: ResultRecord) {
  return {
    summary: row.summary,
    errors: row.errors,
    location: row.location,
    durationMs: row.durationMs,
  };
}

function key(input: KeyInput): CaseOutput {
  const hashOf = (path: string) => input.hashes[path] ?? null;
  const env = environmentHash(input.core, input.runner, hashOf);
  const closure = {
    testFile: input.testFile,
    paths: input.closure,
    complete: true,
    method: CLOSURE_METHOD,
  };
  return { keys: { env, check: checkKey(env, closure, hashOf, input.dependencies) } };
}

/** The rows a run stores for one file, and the same read back after the tree's own `putMany`. */
function rows(input: RowsInput, scratch: string): CaseOutput {
  const records = recordsForFile({
    ref: input.testFile,
    key: KEY,
    report: { ...REPORT, completedFiles: [input.testFile], ...input.report },
    previousChecks: input.previousChecks,
    provenance: PROVENANCE,
    describe: describeFailure,
  });
  const store = scratchStore(scratch);
  try {
    store.results.putMany(records);
    const stored = store.results.byKey(KEY, 0);
    return {
      outputs: { rows: records.map(verdictOf), stored: stored.map(verdictOf) },
      wording: { rows: records.map(wordingOf), stored: stored.map(wordingOf) },
    };
  } finally {
    store.close();
  }
}

/** Runs `c` at this tree; `scratch` is its own empty directory. */
export async function runCase(c: Case, scratch: string): Promise<CaseOutput> {
  switch (c.kind) {
    case "key":
      return key(c.input);
    case "rows":
      return rows(c.input, join(scratch, "store"));
  }
}
