import { describe, expect, it } from "vitest";
import { headerLines } from "../../src/core/delivery/header.js";
import { recoveryProvenance } from "../../src/core/delivery/provenance.js";
import type { EnvironmentDescriptor } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { stateFromResult } from "../../src/core/state/derive.js";
import { compareEnvironment, comparisonText } from "../../src/core/status/import-environment.js";
import { importDefaultLines, importLines } from "../../src/core/status/import-lines.js";
import { readImports } from "../../src/core/status/imports.js";
import { recordWorktreeEnvironments } from "../../src/core/store/environments.js";
import type { ExportedTestFile, ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { TransitionEntry } from "../../src/core/types/delivery.js";
import type { KnownState } from "../../src/core/types/state.js";
import type { ImportStatus, StatusHeader, StatusSnapshot } from "../../src/core/types/status.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 018 D5 from fixtures: one exported file per reason it is not current
 * here, counted in order (same key with another result kept, same key not
 * adopted yet, environment, closure list, observed set, content, no local
 * key); a file is current from an import only by the states the daemon
 * adopted (review wave-1-2 B1); D4's texts in `status --full`, the default
 * status line, the hook header and a recovery's provenance.
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

/** The states this worktree's daemon derives from the results at its keys, once it adopted them. */
function adopted(store: Store): KnownState[] {
  return store.testFileKeys
    .list(HERE)
    .flatMap((k) => store.results.byKey(k.key, 0).map((r) => stateFromResult(HERE, 1, r, k, null)));
}

/** A result this worktree's own run stored for `t/current.test.ts` at the exported key. */
function ownResult(store: Store, outcome: "pass" | "fail"): void {
  store.results.putMany([
    {
      check: { kind: "test", project: "", testPath: "t/current.test.ts", fullName: "passes" },
      key: "k-current",
      outcome,
      durationMs: 1,
      location: null,
      fingerprint: null,
      summary: outcome === "fail" ? "expected 1 to be 2" : null,
      errors: [],
      provenance: {
        worktreeId: HERE,
        revision: 1,
        commit: COMMIT,
        dirty: false,
        runId: "r",
        recordedAt: 2,
      },
    },
  ]);
}

/** `readImports` over the key rows of `paths` only. */
function readOf(store: Store, paths: readonly string[], states: readonly KnownState[]) {
  const keys = store.testFileKeys.list(HERE).filter((k) => paths.includes(k.testFile.path));
  return readImports(store, HERE, keys, states);
}

const SOURCE = "CI run 77 on o/r at cccccccc";
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
const counts = (imports: readonly ImportStatus[]) =>
  imports.map(({ importId, currentResults, currentFiles, notCurrent }) => ({
    importId,
    currentResults,
    currentFiles,
    notCurrent,
  }));

describe("status names why imported files are not current (018 D5)", () => {
  it("counts each reason, in order, and names the environment's differences", () => {
    const store = here();
    const ci = { nodeVersion: "v26.13.0", ci: true };
    importResults(store, bundle(ci), { importId: "imp", fileHash: "h", now: 5 });
    const imports = readImports(store, HERE, store.testFileKeys.list(HERE), adopted(store));
    expect(imports).toEqual([
      {
        importId: "imp",
        source: SOURCE,
        commit: COMMIT,
        importedAt: 5,
        currentResults: 1,
        testFiles: 6,
        currentFiles: 1,
        notCurrent: { ...NONE, environment: 1, closure: 1, observed: 1, content: 1, noKey: 1 },
        environmentDifferences: ["other: Node v26.13.0 in the export, v24.22.1 here"],
        node: { exported: "v26.13.0", here: "v24.22.1", only: true },
      },
    ]);
    expect(importLines({ imports } as unknown as StatusSnapshot)).toEqual([
      `Imported: 1 of 6 test files current from ${SOURCE} (1 current result)`,
      "  Not current: 1 environment differs (other: Node v26.13.0 in the export, v24.22.1 here), 1 closure list differs, 1 observed set differs, 1 content differs, 1 no local key yet",
      "  Imported files have no coverage record until they run here",
    ]);
    // An import with a current file adds no line to the default text.
    expect(importDefaultLines({ imports } as unknown as StatusSnapshot)).toEqual([]);
  });

  it.each(["fail", "pass"] as const)(
    "a local %s the import did not replace is not current from it (review B1)",
    (outcome) => {
      const store = here();
      ownResult(store, outcome);
      importResults(store, bundle({}), { importId: "imp", fileHash: "h", now: 5 });
      const states = adopted(store);
      expect(states.map((s) => [s.outcome, s.validity, s.origin?.kind])).toEqual([
        [outcome, "current", "own"],
      ]);
      const imports = readOf(store, ["t/current.test.ts"], states);
      expect(counts(imports)).toEqual([
        {
          importId: "imp",
          currentResults: 0,
          currentFiles: 0,
          notCurrent: { ...NONE, sameKeyKept: 1 },
        },
      ]);
      expect(importLines({ imports } as unknown as StatusSnapshot)).toEqual([
        `Imported: 0 of 1 test file current from ${SOURCE} (0 current results)`,
        "  Not current: 1 another result kept at the same key",
      ]);
      expect(importDefaultLines({ imports } as unknown as StatusSnapshot)).toEqual([]);
    },
  );

  it("before the daemon adopts it, an import at an equal key is not adopted yet; a second at that key keeps the first's", () => {
    const store = here();
    importResults(store, bundle({}), { importId: "imp", fileHash: "h", now: 5 });
    importResults(store, bundle({}), { importId: "imp2", fileHash: "h2", now: 6 });
    const paths = ["t/current.test.ts", "t/content.test.ts"];
    const before = readOf(store, paths, []);
    expect(counts(before)).toEqual([
      {
        importId: "imp2",
        currentResults: 0,
        currentFiles: 0,
        notCurrent: { ...NONE, sameKeyKept: 1, content: 1 },
      },
      {
        importId: "imp",
        currentResults: 0,
        currentFiles: 0,
        notCurrent: { ...NONE, sameKeyNotAdopted: 1, content: 1 },
      },
    ]);
    expect(importLines({ imports: before } as unknown as StatusSnapshot)[3]).toBe(
      "  Not current: 1 not adopted yet, 1 content differs",
    );
    const after = readOf(store, paths, adopted(store));
    expect(counts(after)).toEqual([
      {
        importId: "imp2",
        currentResults: 0,
        currentFiles: 0,
        notCurrent: { ...NONE, sameKeyKept: 1, content: 1 },
      },
      { importId: "imp", currentResults: 1, currentFiles: 1, notCurrent: { ...NONE, content: 1 } },
    ]);
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

  it("the default text says nothing when the environment is one reason among others (review N1)", () => {
    const store = here();
    importResults(store, bundle({ nodeVersion: "v26.13.0" }), {
      importId: "imp",
      fileHash: "h",
      now: 5,
    });
    const imports = readOf(store, ["t/env.test.ts", "t/content.test.ts"], []);
    expect(counts(imports)[0]?.notCurrent).toEqual({ ...NONE, environment: 1, content: 1 });
    expect(importDefaultLines({ imports } as unknown as StatusSnapshot)).toEqual([]);
  });

  it("no import, or none with a file this worktree lists, says nothing", () => {
    const store = here();
    expect(readImports(store, HERE, store.testFileKeys.list(HERE), [])).toEqual([]);
    importResults(store, bundle({}), { importId: "imp", fileHash: "h", now: 5 });
    expect(readImports(store, "fedcba9876543210", [], [])).toEqual([]);
  });
});

describe("squeal import's environment line (018 D3)", () => {
  it("names each difference, and the project when it has a name", () => {
    const exported = { hash: "env-ci", descriptor: descriptor("web", { nodeVersion: "v26.13.0" }) };
    const local = { project: "web", hash: "env-dev", descriptor: descriptor("web"), recordedAt: 1 };
    expect(comparisonText("web", compareEnvironment(exported, local))).toBe(
      'Environment of project "web": differs from this worktree\'s: Node v26.13.0 in the export, v24.22.1 here',
    );
    expect(comparisonText("", compareEnvironment(exported, { ...local, hash: "env-ci" }))).toBe(
      "Environment: equal to this worktree's",
    );
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
