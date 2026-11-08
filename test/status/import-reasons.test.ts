import { describe, expect, it } from "vitest";
import { headerLines } from "../../src/core/delivery/header.js";
import { recoveryProvenance } from "../../src/core/delivery/provenance.js";
import type { EnvironmentDescriptor } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { importDefaultLines, importLines } from "../../src/core/status/import-lines.js";
import { readImports } from "../../src/core/status/imports.js";
import { recordWorktreeEnvironments } from "../../src/core/store/environments.js";
import { importResults } from "../../src/core/store/transfer.js";
import type { ExportedTestFile, ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import type { TransitionEntry } from "../../src/core/types/delivery.js";
import type { StatusHeader, StatusSnapshot } from "../../src/core/types/status.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 018 D5 from fixtures: one exported file per reason it is not current
 * here, counted in order (environment, closure list, observed set, content,
 * no local key); D4's texts in `status --full`, the default status line, the
 * hook header and a recovery's provenance.
 */

const HERE = "0123456789abcdef";
const COMMIT = "c".repeat(40);

function descriptor(
  project: string,
  parts: Partial<EnvironmentDescriptor> = {},
): EnvironmentDescriptor {
  return {
    keyFormat: KEY_FORMAT_VERSION,
    project,
    runnerName: "vitest",
    runnerVersion: "4.0.0",
    adapterVersion: "1",
    nodeVersion: "v24.22.1",
    platform: "linux",
    arch: "x64",
    installedDependencies: "deps",
    env: { names: [], hash: "none" },
    config: { allowOnly: "a" },
    files: [],
    ci: false,
    ...parts,
  };
}

const file = (
  project: string,
  path: string,
  key: string,
  parts: Partial<ExportedTestFile> = {},
): ExportedTestFile => ({
  project,
  path,
  key,
  closure: { paths: [path], complete: true, method: "static imports plus declared inputs" },
  observed: {},
  ...parts,
});

/** An export of six files; `ci` sets the CI-side environment of project `other`. */
function bundle(ci: Partial<EnvironmentDescriptor>): ResultsBundle {
  const testFiles = [
    file("", "t/current.test.ts", "k-current"),
    file("other", "t/env.test.ts", "k-env", {
      closure: { paths: ["x"], complete: true, method: "static imports plus declared inputs" },
    }),
    file("", "t/closure.test.ts", "k-closure", {
      closure: {
        paths: ["t/closure.test.ts", "src/a.ts"],
        complete: true,
        method: "static imports plus declared inputs",
      },
    }),
    file("", "t/observed.test.ts", "k-observed", { observed: { observed: ["src/x.ts"] } }),
    file("", "t/content.test.ts", "k-content"),
    file("", "t/nokey.test.ts", "k-nokey"),
  ];
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      commit: COMMIT,
      dirty: false,
      createdAt: 1,
      source: {
        kind: "github",
        repository: "o/r",
        runId: "77",
        ref: "refs/heads/main",
        event: "push",
        sha: COMMIT,
      },
    },
    environments: [
      { project: "", hash: "env-same", descriptor: descriptor("") },
      { project: "other", hash: "env-ci", descriptor: descriptor("other", ci) },
    ],
    testFiles,
    observedStartup: [],
    results: testFiles.map((f) => ({
      project: f.project,
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

/** This worktree's side: its keys, environments, a closure list and an observed entry of its own. */
function here(): Store {
  const store = open(fakeCommonDir());
  recordWorktreeEnvironments(
    store,
    HERE,
    [
      { hash: "env-same", descriptor: descriptor("") },
      { hash: "env-dev", descriptor: descriptor("other") },
    ],
    1,
  );
  const ref = (path: string) => ({ project: "", path });
  store.testFiles.put({
    testFile: ref("t/closure.test.ts"),
    closure: {
      testFile: ref("t/closure.test.ts"),
      paths: ["t/closure.test.ts"],
      complete: true,
      method: "static imports plus declared inputs",
    },
    updatedAt: 1,
    updatedBy: HERE,
  });
  store.meta.set(observedMetaKey(""), JSON.stringify({ "t/observed.test.ts": ["src/y.ts"] }));
  const keys: [string, string, string | null][] = [
    ["", "t/current.test.ts", "k-current"],
    ["other", "t/env.test.ts", "k-env-here"],
    ["", "t/closure.test.ts", "k-closure-here"],
    ["", "t/observed.test.ts", "k-observed-here"],
    ["", "t/content.test.ts", "k-content-here"],
    ["", "t/nokey.test.ts", null],
  ];
  store.testFileKeys.upsertMany(
    keys.map(([project, path, key]) => ({
      worktreeId: HERE,
      testFile: { project, path },
      key,
      revision: 1,
      pending: null,
    })),
  );
  return store;
}

const SOURCE = "CI run 77 on o/r at cccccccc";

describe("status names why imported files are not current (018 D5)", () => {
  it("counts each reason, in order, and names the environment's differences", () => {
    const store = here();
    const ci = { nodeVersion: "v26.13.0", ci: true };
    importResults(store, bundle(ci), { importId: "imp", fileHash: "h", now: 5 });
    const imports = readImports(store, HERE, store.testFileKeys.list(HERE), []);
    expect(imports).toEqual([
      {
        importId: "imp",
        source: SOURCE,
        commit: COMMIT,
        importedAt: 5,
        currentResults: 0,
        testFiles: 6,
        currentFiles: 1,
        notCurrent: { environment: 1, closure: 1, observed: 1, content: 1, noKey: 1 },
        environmentDifferences: ["other: Node v26.13.0 in the export, v24.22.1 here"],
      },
    ]);
    expect(importLines({ imports } as unknown as StatusSnapshot)).toEqual([
      `Imported: 1 of 6 test files current from ${SOURCE} (0 current results)`,
      "  Not current: 1 environment differs (other: Node v26.13.0 in the export, v24.22.1 here), 1 closure list differs, 1 observed set differs, 1 content differs, 1 no local key yet",
    ]);
    // An import with a current file adds no line to the default text.
    expect(importDefaultLines({ imports } as unknown as StatusSnapshot)).toEqual([]);
  });

  it("the default text adds one line when the environment keeps every file from being current", () => {
    const store = here();
    const ci = { nodeVersion: "v26.13.0", platform: "darwin", config: { allowOnly: "b" } };
    importResults(store, bundle(ci), { importId: "imp", fileHash: "h", now: 5 });
    const keys = store.testFileKeys.list(HERE).filter((k) => k.testFile.project === "other");
    const imports = readImports(store, HERE, keys, []);
    expect(importDefaultLines({ imports } as unknown as StatusSnapshot)).toEqual([
      `Imported results from ${SOURCE}: none current here, the environment differs (Node v26.13.0 in the export, v24.22.1 here; platform darwin in the export, linux here; 1 more in squeal status --full)`,
    ]);
  });

  it("no import, or none with a file this worktree lists, says nothing", () => {
    const store = here();
    expect(readImports(store, HERE, store.testFileKeys.list(HERE), [])).toEqual([]);
    importResults(store, bundle({}), { importId: "imp", fileHash: "h", now: 5 });
    expect(readImports(store, "fedcba9876543210", [], [])).toEqual([]);
  });
});

describe("the imported origin in the hook header and provenance (018 D4)", () => {
  it("the header counts imported results beside inherited ones", () => {
    const header: StatusHeader = {
      revision: 7,
      counts: { current: 10, pending: 0, stale: 0, unknown: 0 },
      fileLevelCounts: { current: 3, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      importedCount: 6,
    };
    expect(headerLines(header, "squeal")[0]).toContain(" Imported: 6 of 10 current. ");
    expect(headerLines({ ...header, importedCount: 0 }, "squeal")[0]).not.toContain("Imported");
  });

  it("a recovery to an imported pass names the import's source", () => {
    const entry: TransitionEntry = {
      check: { kind: "test", project: "", testPath: "t/a.test.ts", fullName: "passes" },
      kind: "fail-to-pass",
      from: "fail",
      to: "pass",
      validity: "current",
      observedAt: 7,
      origin: { kind: "imported", importId: "imp", commit: COMMIT },
      originSource: SOURCE,
      summary: null,
      location: null,
    };
    expect(recoveryProvenance(entry, 7)).toBe(`imported from ${SOURCE}`);
    const { originSource: _, ...unnamed } = entry;
    expect(recoveryProvenance(unnamed, 7)).toBe("imported from import imp at commit cccccccccccc");
  });
});
