/*
 * Throwaway probe for issue 6 (research/issue-6-exact-file-waits.md). Runs
 * only inside a /tmp copy of the repository: `run-selector.sh` copies it to
 * `test/cli/issue6-selector.probe.test.ts` there. Not part of the suite.
 *
 * It builds each test file's closure with the product's own
 * `createDeclaredInputs` and `assembleClosure`, stores it as the daemon does,
 * and asks `selectNamedFiles` (spec 005 D2) which test files a path selects.
 * Each case prints one `ISSUE6 {...}` line: the expected selection per D2
 * and the actual one. Nothing is asserted, so the run records the behaviour
 * whatever it is.
 */
import { it } from "vitest";
import { selectNamedFiles } from "../../src/cli/status-wait-paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { assembleClosure, createDeclaredInputs } from "../../src/core/keys/closure.js";
import { withStatusStore } from "../../src/core/status/index.js";
import type { PolicyInputs, RelativePath, Store } from "../../src/core/types/index.js";
import { NOW, ref, repoWith } from "./status-wait-fixture.js";

/** Stores each test file's closure as the daemon would: imports plus declared inputs. */
function storeClosures(
  store: Store,
  by: string,
  inputs: PolicyInputs,
  files: readonly string[],
  imports: Readonly<Record<string, readonly string[]>>,
) {
  const declared = createDeclaredInputs(inputs, files as RelativePath[]);
  for (const [testFile, paths] of Object.entries(imports)) {
    const closure = assembleClosure(
      { testFile: ref(testFile), paths: paths as RelativePath[] } as never,
      declared.for(testFile as RelativePath),
    );
    store.testFiles.put({ testFile: ref(testFile), closure, updatedAt: NOW, updatedBy: by });
  }
}

function select(root: string, paths: readonly string[]) {
  const read = withStatusStore(root, {}, ({ store, root: found }) =>
    selectNamedFiles(store, worktreeIdFor(found), found, root, paths),
  );
  if ("available" in read) throw new Error(read.message);
  return { files: read.files.map((f) => f.path), unmatched: read.unmatched };
}

function report(name: string, named: string[], expected: string[], actual: { files: string[] }) {
  const same = JSON.stringify([...expected].sort()) === JSON.stringify([...actual.files].sort());
  console.log(
    `ISSUE6 ${JSON.stringify({ case: name, named, expected, actual: actual.files, matchesD2: same })}`,
  );
}

// The issue's shape: `.github/scripts/*.test.cjs` declares `.github/scripts/**`.
const LEDGER = ".github/scripts/upstream-ledger.test.cjs";
const TARGETS = ".github/scripts/upstream-targets.test.cjs";
const LIB = ".github/scripts/lib.cjs";
const SCRIPTS = [LEDGER, TARGETS, LIB];

it("case 1: an exact test path with overlapping declared inputs", () => {
  const { repo, store } = repoWith([], [LEDGER, TARGETS]);
  const inputs = { ".github/scripts/*.test.cjs": [".github/scripts/**"] };
  storeClosures(store, repo.mainId, inputs, SCRIPTS, { [LEDGER]: [], [TARGETS]: [] });
  report("exact-test-overlap", [LEDGER], [LEDGER], select(repo.main, [LEDGER]));
});

it("case 2: a source path with the same inputs still selects every consumer", () => {
  const { repo, store } = repoWith([], [LEDGER, TARGETS]);
  const inputs = { ".github/scripts/*.test.cjs": [".github/scripts/**"] };
  storeClosures(store, repo.mainId, inputs, SCRIPTS, { [LEDGER]: [], [TARGETS]: [] });
  report("source-overlap", [LIB], [LEDGER, TARGETS], select(repo.main, [LIB]));
});

// The comments' shape: an E2E spec declares a source tree holding a unit test.
const UNIT = "packages/web/src/test/card-2-contrast.test.ts";
const E2E = "packages/web/e2e/create-project.e2e.ts";
const CARD = "packages/web/src/card.ts";

it("case 3: an exact unit-test path under an E2E spec's declared source tree", () => {
  const { repo, store } = repoWith([], [UNIT, E2E]);
  const inputs = { "packages/web/e2e/*.e2e.ts": ["packages/web/src/**"] };
  storeClosures(store, repo.mainId, inputs, [UNIT, E2E, CARD], { [UNIT]: [CARD], [E2E]: [] });
  report("exact-unit-under-e2e-inputs", [UNIT], [UNIT], select(repo.main, [UNIT]));
  report("source-under-e2e-inputs", [CARD], [UNIT, E2E], select(repo.main, [CARD]));
});

it("case 4: control, inputs that do not cover the other test file", () => {
  const { repo, store } = repoWith([], [LEDGER, TARGETS]);
  const inputs = { ".github/scripts/*.test.cjs": [".github/scripts/lib.cjs"] };
  storeClosures(store, repo.mainId, inputs, SCRIPTS, { [LEDGER]: [], [TARGETS]: [] });
  report("exact-test-no-overlap", [LEDGER], [LEDGER], select(repo.main, [LEDGER]));
  report("source-no-overlap", [LIB], [LEDGER, TARGETS], select(repo.main, [LIB]));
});

it("case 5: one test file imports another, no declared inputs", () => {
  const { repo, store } = repoWith([], [LEDGER, TARGETS]);
  storeClosures(store, repo.mainId, [], SCRIPTS, { [LEDGER]: [], [TARGETS]: [LEDGER] });
  report("exact-test-imported", [LEDGER], [LEDGER], select(repo.main, [LEDGER]));
});
