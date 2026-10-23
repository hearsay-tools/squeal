import { join } from "node:path";
import {
  CLOSURE_METHOD,
  checkKey,
  dependencyKeys,
  environmentHash,
  installedDependencies,
} from "../../../src/core/keys/index.js";
import { recordsForFile } from "../../../src/core/scheduler/records.js";
import { describeFailure } from "../../../src/core/state/fingerprint.js";
import type { Case, CaseOutput, KeyInput, RowsInput } from "./case.js";
import { decideAccept, writeAccept } from "./harness/accept.js";
import { assemble } from "./harness/assemble.js";
import { observe } from "./harness/observe.js";
import { pytestCase } from "./harness/pytest.js";
import {
  KEY,
  provenance,
  REPORT,
  scratchStore,
  verdictOf,
  wordingOf,
  writeTree,
} from "./harness/shared.js";
import { storeCase } from "./harness/store.js";
import { vitestCase } from "./harness/vitest.js";

/*
 * One function per case kind (task 011-37 section 3). Bundled once against
 * each tree: every `src/` import here and under `harness/` resolves into the
 * tree under test, so these lines are the same at both and only the tree's
 * code differs. A tree that moves a function is read at the new path, the
 * old one kept for the last release until it carries the move.
 */

async function key(input: KeyInput, scratch: string): Promise<CaseOutput> {
  const hashOf = (path: string) => input.hashes[path] ?? null;
  let core = input.core;
  let dependencies = input.dependencies;
  if (input.installed !== undefined) {
    const root = writeTree(join(scratch, "install"), input.installed);
    const installed = await installedDependencies(root, root);
    core = { ...core, installedDependencies: installed.fingerprint };
    if (input.packages !== undefined) {
      const keys = dependencyKeys(installed, input.packages.environment);
      core = { ...core, installedDependencies: keys.environment };
      dependencies = keys.of(input.packages.testFile);
    }
  }
  const env = environmentHash(core, input.runner, hashOf);
  const closure = {
    testFile: input.testFile,
    paths: input.closure,
    complete: true,
    method: CLOSURE_METHOD,
  };
  return { keys: { env, check: checkKey(env, closure, hashOf, dependencies) } };
}

/** The rows a run stores for one file, and the same read back after the tree's own `putMany`. */
function rows(input: RowsInput, scratch: string): CaseOutput {
  const records = recordsForFile({
    ref: input.testFile,
    key: KEY,
    report: { ...REPORT, completedFiles: [input.testFile], ...input.report },
    previousChecks: input.previousChecks,
    provenance: provenance("validity-a"),
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

/** Runs `c` at this tree; `scratch` is its own empty directory, `runtime` the tree's recorder files. */
export async function runCase(c: Case, scratch: string, runtime: string): Promise<CaseOutput> {
  switch (c.kind) {
    case "key":
      return key(c.input, scratch);
    case "rows":
      return rows(c.input, join(scratch, "store"));
    case "observe":
      return observe(c.input, scratch, runtime);
    case "accept":
      return writeAccept(c.input, scratch);
    case "assemble":
      return assemble(c.input, scratch);
    case "store":
      return storeCase(c.input, scratch);
    case "adapter:vitest":
      return vitestCase(c.input, scratch);
    case "adapter:pytest":
      return pytestCase(c.input, scratch);
  }
}

/** This tree's decision over what `runCase` stored for `c` at `stored`, `undefined` for a kind with none. */
export async function decideCase(
  c: Case,
  stored: string,
  scratch: string,
): Promise<CaseOutput | undefined> {
  return c.kind === "accept" ? decideAccept(c.input, stored, scratch) : undefined;
}
