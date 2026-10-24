import { describe, expect, it } from "vitest";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { assembleClosure, createDeclaredInputs } from "../../src/core/keys/closure.js";
import { withStatusStore } from "../../src/core/status/index.js";
import type { PolicyInputs, RelativePath, Store } from "../../src/core/types/index.js";
import { NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Spec 005 D2: "A test-file path selects itself. Any other path selects the
 * test files whose closure holds it." Task 005-67 (issue 6): a listed test
 * file's path selects that file alone, even when another test file's closure
 * holds it through declared inputs or an import. The cases are the probe's,
 * `research/probes/issue-6-exact-file-waits/`, with closures built as the
 * daemon builds them.
 */

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
  return { files: read.files.map((f) => f.path).sort(), unmatched: read.unmatched };
}

const LEDGER = ".github/scripts/upstream-ledger.test.cjs";
const TARGETS = ".github/scripts/upstream-targets.test.cjs";
const LIB = ".github/scripts/lib.cjs";
const SCRIPTS = [LEDGER, TARGETS, LIB];
const SIBLING_GLOB = { ".github/scripts/*.test.cjs": [".github/scripts/**"] };

const UNIT = "packages/web/src/test/card-2-contrast.test.ts";
const E2E = "packages/web/e2e/create-project.e2e.ts";
const CARD = "packages/web/src/card.ts";
const E2E_GLOB = { "packages/web/e2e/*.e2e.ts": ["packages/web/src/**"] };

describe("selectNamedFiles with overlapping closures (issue 6)", () => {
  it("selects only the named test file when a sibling's declared inputs hold it", () => {
    const { repo, store } = repoWith([], [LEDGER, TARGETS]);
    storeClosures(store, repo.mainId, SIBLING_GLOB, SCRIPTS, { [LEDGER]: [], [TARGETS]: [] });
    expect(select(repo.main, [LEDGER])).toEqual({ files: [LEDGER], unmatched: [] });
    expect(select(repo.main, [LIB])).toEqual({ files: [LEDGER, TARGETS].sort(), unmatched: [] });
  });

  it("selects only a unit test inside an E2E spec's declared source tree", () => {
    const { repo, store } = repoWith([], [UNIT, E2E]);
    storeClosures(store, repo.mainId, E2E_GLOB, [UNIT, E2E, CARD], { [UNIT]: [CARD], [E2E]: [] });
    expect(select(repo.main, [UNIT])).toEqual({ files: [UNIT], unmatched: [] });
    expect(select(repo.main, [CARD])).toEqual({ files: [E2E, UNIT].sort(), unmatched: [] });
  });

  it("selects only an imported test file, not the test file that imports it", () => {
    const { repo, store } = repoWith([], [LEDGER, TARGETS]);
    storeClosures(store, repo.mainId, [], SCRIPTS, { [LEDGER]: [], [TARGETS]: [LEDGER] });
    expect(select(repo.main, [LEDGER])).toEqual({ files: [LEDGER], unmatched: [] });
  });

  it("applies each rule to its own path when a test path and a source path are named together", () => {
    const { repo, store } = repoWith([], [UNIT, E2E, LEDGER, TARGETS]);
    storeClosures(
      store,
      repo.mainId,
      { ...E2E_GLOB, ...SIBLING_GLOB },
      [...SCRIPTS, UNIT, E2E, CARD],
      {
        [UNIT]: [CARD],
        [E2E]: [],
        [LEDGER]: [],
        [TARGETS]: [],
      },
    );
    expect(select(repo.main, [LEDGER, CARD])).toEqual({
      files: [E2E, LEDGER, UNIT].sort(),
      unmatched: [],
    });
  });
});
