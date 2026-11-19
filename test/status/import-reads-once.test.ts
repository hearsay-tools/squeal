import { describe, expect, it } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { stateFromResult } from "../../src/core/state/derive.js";
import { importLines } from "../../src/core/status/import-lines.js";
import { readImports } from "../../src/core/status/imports.js";
import type { ExportedTestFile, ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { KnownState } from "../../src/core/types/state.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 011-411 (gh-250, option A): `readImports` makes each test file's
 * closure and observed hash once per read, not once per stored import, and
 * says of every import what it said before. The same files stand apart for
 * another reason in each import here: a closure list, an observed set, the
 * content, an equal key the daemon adopted.
 */

const HERE = "0123456789abcdef";
const COMMIT = "c".repeat(40);
const METHOD = "static imports plus declared inputs";
const A = "t/a.test.ts";
const B = "t/b.test.ts";
const C = "t/c.test.ts";
const D = "t/d.test.ts";

const file = (path: string, key: string, paths: string[], observed: string[] = []) =>
  ({
    project: "",
    path,
    key,
    closure: { paths, complete: true, method: METHOD },
    observed: observed.length === 0 ? {} : { observed },
  }) as ExportedTestFile;

function bundle(runId: string, testFiles: readonly ExportedTestFile[]): ResultsBundle {
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      commit: COMMIT,
      dirty: false,
      createdAt: 1,
      source: { kind: "github", repository: "o/r", runId, ref: null, event: "push", sha: COMMIT },
    },
    environments: [],
    testFiles: [...testFiles],
    observedStartup: [],
    results: testFiles.map((f) => ({
      project: "",
      testPath: f.path,
      kind: "test" as const,
      fullName: "passes",
      location: null,
      key: f.key,
      outcome: "pass" as const,
      durationMs: 3,
    })),
  };
}

/** This worktree: A at an exported key, B and C at their own, D without one; C observed `src/x.ts`. */
function here(): Store {
  const store = open(fakeCommonDir());
  const ref = (path: string) => ({ project: "", path });
  for (const [path, paths] of [
    [B, [B]],
    [C, [C, "src/x.ts"]],
  ] as const) {
    store.testFiles.put({
      testFile: ref(path),
      closure: { testFile: ref(path), paths: [...paths], complete: true, method: METHOD },
      updatedAt: 1,
      updatedBy: HERE,
    });
  }
  store.meta.set(observedMetaKey(""), JSON.stringify({ [C]: ["src/x.ts"] }));
  const keys: [string, string | null][] = [
    [A, "k-a"],
    [B, "k-b"],
    [C, "k-c"],
    [D, null],
  ];
  store.testFileKeys.upsertMany(
    keys.map(([path, key]) => ({
      worktreeId: HERE,
      testFile: ref(path),
      key,
      revision: 1,
      pending: null,
    })),
  );
  // Three CI runs, oldest first: each keeps a file apart for another reason.
  importResults(
    store,
    bundle("1", [
      file(A, "k-a", [A]),
      file(B, "k-b-1", [B, "src/old.ts"]),
      file(C, "k-c-1", [C]),
      file(D, "k-d-1", [D]),
    ]),
    { importId: "imp1", fileHash: "h1", now: 5 },
  );
  importResults(
    store,
    bundle("2", [
      file(A, "k-a", [A]),
      file(B, "k-b-2", [B]),
      file(C, "k-c-2", [C, "src/x.ts"], ["src/x.ts"]),
    ]),
    { importId: "imp2", fileHash: "h2", now: 6 },
  );
  importResults(store, bundle("3", [file(B, "k-b", [B]), file(C, "k-c-3", [C, "src/y.ts"])]), {
    importId: "imp3",
    fileHash: "h3",
    now: 7,
  });
  return store;
}

/** The states the daemon derives from the results at this worktree's keys, once it adopted them. */
function adopted(store: Store): KnownState[] {
  return store.testFileKeys
    .list(HERE)
    .flatMap((k) =>
      k.key === null
        ? []
        : store.results.byKey(k.key, 0).map((r) => stateFromResult(HERE, 1, r, k, null)),
    );
}

/** Each call of `store.testFiles.get` from now on, counted by test file. */
function countGets(store: Store): Map<string, number> {
  const gets = new Map<string, number>();
  const get = store.testFiles.get;
  store.testFiles.get = (ref) => {
    gets.set(ref.path, (gets.get(ref.path) ?? 0) + 1);
    return get(ref);
  };
  return gets;
}

const NONE = {
  sameKeyKept: 0,
  sameKeyNotAdopted: 0,
  environment: 0,
  closure: 0,
  observed: 0,
  content: 0,
  keysPending: 0,
  noKey: 0,
};

describe("status compares each test file once per read, whatever the imports (row 011-411)", () => {
  it("says of every import what it said before (018 D5)", () => {
    const store = here();
    const imports = readImports(store, HERE, store.testFileKeys.list(HERE), adopted(store));

    expect(imports).toEqual([
      {
        importId: "imp3",
        source: "CI run 3 on o/r at cccccccc",
        commit: COMMIT,
        importedAt: 7,
        currentResults: 1,
        testFiles: 2,
        currentFiles: 1,
        notCurrent: { ...NONE, closure: 1 },
        environmentDifferences: [],
      },
      {
        importId: "imp2",
        source: "CI run 2 on o/r at cccccccc",
        commit: COMMIT,
        importedAt: 6,
        currentResults: 0,
        testFiles: 3,
        currentFiles: 0,
        notCurrent: { ...NONE, sameKeyKept: 1, content: 2 },
        environmentDifferences: [],
      },
      {
        importId: "imp1",
        source: "CI run 1 on o/r at cccccccc",
        commit: COMMIT,
        importedAt: 5,
        currentResults: 1,
        testFiles: 4,
        currentFiles: 1,
        notCurrent: { ...NONE, closure: 1, observed: 1, noKey: 1 },
        environmentDifferences: [],
      },
    ]);
    expect(importLines({ imports } as unknown as StatusSnapshot)).toEqual([
      "Imported: 1 of 2 test files current from CI run 3 on o/r at cccccccc (1 current result)",
      "  Not current: 1 closure list differs",
      "  Imported files have no coverage record until they run here",
      "Imported: 0 of 3 test files current from CI run 2 on o/r at cccccccc (0 current results)",
      "  Not current: 1 another result kept at the same key, 2 content differs",
      "Imported: 1 of 4 test files current from CI run 1 on o/r at cccccccc (1 current result)",
      "  Not current: 1 closure list differs, 1 observed set differs, 1 no local key yet",
      "  Imported files have no coverage record until they run here",
    ]);
  });

  it("reads each test file's closure once, not once per import (gh-250)", () => {
    const store = here();
    const gets = countGets(store);
    readImports(store, HERE, store.testFileKeys.list(HERE), adopted(store));

    // Before row 011-411: B 2 and C 3, one per import that compared its closure.
    expect(Object.fromEntries(gets)).toEqual({ [B]: 1, [C]: 1, [D]: 1 });
  });
});
