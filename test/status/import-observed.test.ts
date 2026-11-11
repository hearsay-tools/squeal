import { describe, expect, it } from "vitest";
import {
  configFieldHash,
  type EnvironmentDescriptor,
} from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { compareEnvironment, comparisonText } from "../../src/core/status/import-environment.js";
import { importLines } from "../../src/core/status/import-lines.js";
import { readImports } from "../../src/core/status/imports.js";
import { recordWorktreeEnvironments } from "../../src/core/store/environments.js";
import { connectionOf } from "../../src/core/store/store.js";
import { listHash, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { ImportStatus, StatusSnapshot } from "../../src/core/types/status.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 018 D15: what status says beside D5. A file whose lists differ only
 * by the observed paths a busy store's union adds reads "observed set
 * differs", not "closure list differs"; an import's environment that differs
 * only in the fields an imported pass may differ in (D10) reads as equal for
 * passes; and `--full` says imported files have no coverage record.
 */

const HERE = "0123456789abcdef";
const TEST = "t/a.test.ts";
const CI_LIST = ["src/a.ts", TEST];
const METHOD = "static imports plus declared inputs" as const;

function descriptor(parts: Partial<EnvironmentDescriptor> = {}): EnvironmentDescriptor {
  return {
    keyFormat: KEY_FORMAT_VERSION,
    project: "",
    runnerName: "vitest",
    runnerVersion: "4.1.10",
    adapterVersion: "7",
    nodeVersion: "v24.22.1",
    platform: "linux",
    arch: "x64",
    installedDependencies: "deps",
    env: { names: [], hash: "none" },
    config: { allowOnly: configFieldHash(true), root: "r" },
    files: [],
    ci: false,
    browser: false,
    ...parts,
  };
}

/** CI's export of one file whose own run observed nothing beyond its static list. */
const BUNDLE: ResultsBundle = {
  format: "squeal-results/1",
  header: {
    squealVersion: "0.0.0",
    keyFormat: KEY_FORMAT_VERSION,
    commit: "c".repeat(40),
    dirty: false,
    createdAt: 1,
    source: { kind: "local" },
  },
  environments: [{ project: "", hash: "env", descriptor: descriptor() }],
  testFiles: [
    {
      project: "",
      path: TEST,
      key: "k-ci",
      closure: { paths: CI_LIST, complete: true, method: METHOD },
      observed: {},
    },
  ],
  observedStartup: [],
  results: [],
};

/** A busy store: its list for the file holds the union's extra path, and its key differs. */
function busy(): Store {
  const store = open(fakeCommonDir());
  recordWorktreeEnvironments(store, HERE, [{ hash: "env", descriptor: descriptor() }], 1);
  const testFile = { project: "", path: TEST };
  store.testFiles.put({
    testFile,
    closure: { testFile, paths: ["src/a.ts", "src/x.ts", TEST], complete: true, method: METHOD },
    updatedAt: 1,
    updatedBy: HERE,
  });
  store.meta.set(observedMetaKey(""), JSON.stringify({ [TEST]: ["src/x.ts"] }));
  store.testFileKeys.upsertMany([
    { worktreeId: HERE, testFile, key: "k-here", revision: 1, pending: null },
  ]);
  return store;
}

const reasons = (store: Store) =>
  readImports(store, HERE, store.testFileKeys.list(HERE), []).map((i) => i.notCurrent);

describe("status beside an import (018 D15)", () => {
  it("names an observed-set difference when the static lists agree", () => {
    const store = busy();
    importResults(store, BUNDLE, { importId: "imp", fileHash: "h", now: 5 });
    expect(reasons(store)).toMatchObject([{ closure: 0, observed: 1 }]);
  });

  it("compares whole lists for a row stored before the static list", () => {
    const store = busy();
    importResults(store, BUNDLE, { importId: "imp", fileHash: "h", now: 5 });
    connectionOf(store).run("UPDATE import_files SET closure = ?", listHash(CI_LIST));
    expect(reasons(store)).toMatchObject([{ closure: 1, observed: 0 }]);
  });

  it("says an environment that differs only in CI's fields is equal for imported passes", () => {
    const ci = descriptor({ config: { allowOnly: configFieldHash(false), root: "r" }, ci: true });
    const local = { project: "", hash: "env", descriptor: descriptor(), recordedAt: 1 };
    expect(comparisonText("", compareEnvironment({ hash: "env-ci", descriptor: ci }, local))).toBe(
      "Environment: equal to this worktree's for imported passes; config fields allowOnly differ (the export ran with CI set)",
    );
  });

  it("says an export that allowed focused tests differs where they are rejected (review wave-5 B2)", () => {
    const focus = descriptor({ config: { allowOnly: configFieldHash(true), root: "r" } });
    const strict = descriptor({ config: { allowOnly: configFieldHash(false), root: "r" } });
    const local = { project: "", hash: "env", descriptor: strict, recordedAt: 1 };
    expect(
      comparisonText("", compareEnvironment({ hash: "env-ci", descriptor: focus }, local)),
    ).toBe("Environment: differs from this worktree's: config fields allowOnly differ");
  });

  it("--full says imported files have no coverage record, once any is current", () => {
    const status = (currentFiles: number): ImportStatus => ({
      importId: "imp",
      source: "CI run 77 on o/r at cccccccc",
      commit: "c".repeat(40),
      importedAt: 5,
      currentResults: currentFiles,
      testFiles: 1,
      currentFiles,
      notCurrent: {
        sameKeyKept: 0,
        sameKeyNotAdopted: 0,
        environment: 0,
        closure: 0,
        observed: 0,
        content: 1 - currentFiles,
        keysPending: 0,
        noKey: 0,
      },
      environmentDifferences: [],
    });
    const lines = (i: ImportStatus) => importLines({ imports: [i] } as unknown as StatusSnapshot);
    expect(lines(status(1))).toEqual([
      "Imported: 1 of 1 test file current from CI run 77 on o/r at cccccccc (1 current result)",
      "  Imported files have no coverage record until they run here",
    ]);
    expect(lines(status(0))).toEqual([
      "Imported: 0 of 1 test file current from CI run 77 on o/r at cccccccc (0 current results)",
      "  Not current: 1 content differs",
    ]);
  });
});
