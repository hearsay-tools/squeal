import { describe, expect, it } from "vitest";
import {
  configFieldHash,
  type EnvironmentDescriptor,
} from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { stateFromResult } from "../../src/core/state/derive.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { importDefaultLines, importLines } from "../../src/core/status/import-lines.js";
import { readImports } from "../../src/core/status/imports.js";
import { buildSnapshot } from "../../src/core/status/snapshot.js";
import { recordWorktreeEnvironments } from "../../src/core/store/environments.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { KnownState } from "../../src/core/types/state.js";
import type { ImportStatus, StatusSnapshot } from "../../src/core/types/status.js";
import { fakeRepo, seedStore } from "./helpers.js";

/*
 * Row 018-32 (spec 018 D5, D10, D15), the case found in squawk's main
 * checkout: an import from before the re-key at import (0.1.431) kept CI's
 * keys, whose environment differs from here only in fields D10 accepts; a
 * newer import's keys equal this worktree's, where its own results stay.
 * Default status names the newest import only, and only when a difference
 * that keeps an imported pass apart blocks one of its files (R1); it counts
 * the files whose key here equals the import's as matching, and names only
 * those differences.
 */

const PATHS = ["t/a.test.ts", "t/b.test.ts", "t/c.test.ts", "t/d.test.ts"];
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const OLD_SOURCE = "CI run 1 on o/r at aaaaaaaa";
const NEW_SOURCE = "CI run 2 on o/r at bbbbbbbb";

/** This worktree's environment: Vitest outside CI, focused tests allowed, no watch, no browser. */
function descriptor(parts: Partial<EnvironmentDescriptor> = {}): EnvironmentDescriptor {
  return {
    keyFormat: KEY_FORMAT_VERSION,
    project: "",
    runnerName: "vitest",
    runnerVersion: "4.1.10",
    adapterVersion: "1",
    nodeVersion: "v26.13.0",
    platform: "linux",
    arch: "x64",
    installedDependencies: "deps",
    env: { names: [], hash: "none" },
    config: {
      allowOnly: configFieldHash(true),
      watch: configFieldHash(false),
      browser: configFieldHash({ enabled: false }),
      pool: configFieldHash("forks"),
    },
    files: [],
    ci: false,
    browser: false,
    ...parts,
  };
}

/** CI's side: the fields `CI=true` resolves differently, which D10 accepts for a pass. */
const CI_CONFIG = {
  allowOnly: configFieldHash(false),
  watch: configFieldHash(true),
  browser: configFieldHash({ enabled: false, headless: true }),
  pool: configFieldHash("forks"),
};

/** An export of `PATHS` at `commit`, each file at the key `keyOf` gives it. */
function bundle(
  runId: string,
  commit: string,
  environment: { hash: string; descriptor: EnvironmentDescriptor },
  keyOf: (path: string) => string,
): ResultsBundle {
  const testFiles = PATHS.map((path) => ({
    project: "",
    path,
    key: keyOf(path),
    closure: { paths: [path], complete: true, method: "static imports plus declared inputs" },
    observed: {},
  }));
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      commit,
      dirty: false,
      createdAt: 1,
      source: { kind: "github", repository: "o/r", runId, ref: null, event: "push", sha: commit },
    },
    environments: [{ project: "", ...environment }],
    testFiles,
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

/** A worktree that keys `PATHS` at `k-here-<path>`, with its own passes at the first three. */
function worktree() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const id = repo.mainId;
  recordWorktreeEnvironments(store, id, [{ hash: "env-dev", descriptor: descriptor() }], 1);
  store.testFileKeys.upsertMany(
    PATHS.map((path) => ({
      worktreeId: id,
      testFile: { project: "", path },
      key: `k-here-${path}`,
      revision: 1,
      pending: null,
    })),
  );
  store.results.putMany(
    PATHS.slice(0, 3).map((path) => ({
      check: { kind: "test" as const, project: "", testPath: path, fullName: "passes" },
      key: `k-here-${path}`,
      outcome: "pass" as const,
      durationMs: 1,
      location: null,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId: id,
        revision: 1,
        commit: NEW,
        dirty: false,
        runId: "r",
        recordedAt: 2,
      },
    })),
  );
  /** The states this worktree's daemon derives from the results at its keys. */
  const states = (): KnownState[] =>
    store.testFileKeys
      .list(id)
      .flatMap((k) => store.results.byKey(k.key, 0).map((r) => stateFromResult(id, 1, r, k, null)));
  const imports = (): ImportStatus[] =>
    readImports(store, id, store.testFileKeys.list(id), states());
  return { repo, store, id, states, imports };
}

/** The squawk case: the old import at CI's keys, then the newer one at this worktree's keys but one. */
function squawk(w: ReturnType<typeof worktree>): void {
  const ci = { hash: "env-ci", descriptor: descriptor({ config: CI_CONFIG, ci: true }) };
  importResults(
    w.store,
    bundle("1", OLD, ci, (p) => `k-ci-${p}`),
    {
      importId: "imp-old",
      fileHash: "h1",
      now: 5,
    },
  );
  const here = { hash: "env-dev", descriptor: descriptor() };
  const keyOf = (p: string) => (p === "t/d.test.ts" ? "k-moved" : `k-here-${p}`);
  importResults(w.store, bundle("2", NEW, here, keyOf), {
    importId: "imp-new",
    fileHash: "h2",
    now: 6,
  });
}

const snapshot = (imports: readonly ImportStatus[]) => ({ imports }) as unknown as StatusSnapshot;

/** Cezar's checkout at its newest import's own commit (row 018-32's notes): content moved, nothing blocks. */
const CEZAR: ImportStatus = {
  importId: "imp-cezar",
  source: "CI run 43089887527 on o/cezar at 5b278bdc",
  commit: "5b278bdc",
  importedAt: 9,
  currentResults: 0,
  testFiles: 1523,
  currentFiles: 0,
  notCurrent: {
    sameKeyKept: 31,
    sameKeyNotAdopted: 0,
    environment: 45,
    closure: 2,
    observed: 21,
    keysPending: 0,
    content: 1424,
    noKey: 0,
  },
  environmentDifferences: [],
};

describe("the default import line stays silent when the import works (row 018-32 R1, D15)", () => {
  it("content moved since the import's commit and no difference blocks: no line, whatever N is", () => {
    expect(importDefaultLines(snapshot([CEZAR]))).toEqual([]);
    const moved = { ...CEZAR, notCurrent: { ...CEZAR.notCurrent, environment: 0, content: 1469 } };
    expect(importDefaultLines(snapshot([moved]))).toEqual([]);
    const none = { ...moved, notCurrent: { ...moved.notCurrent, sameKeyKept: 0, content: 1500 } };
    expect(importDefaultLines(snapshot([none]))).toEqual([]);
  });

  it("--full keeps every count", () => {
    expect(importLines(snapshot([CEZAR]))).toEqual([
      `Imported: 0 of 1523 test files current from ${CEZAR.source} (0 current results)`,
      "  Not current: 31 another result kept at the same key, 45 environment differs (only in fields an imported pass may differ in, but the import kept the export's keys), 2 closure list differs, 21 observed set differs, 1424 content differs",
    ]);
  });
});

describe("default status names the newest import's matching files (row 018-32)", () => {
  it("the squawk case: the newest import works, so no default line; --full names both", () => {
    const w = worktree();
    squawk(w);
    const imports = w.imports();
    expect(imports.map((i) => [i.importId, i.currentFiles, i.notCurrent.sameKeyKept])).toEqual([
      ["imp-new", 0, 3],
      ["imp-old", 0, 0],
    ]);
    expect(importDefaultLines(snapshot(imports))).toEqual([]);
    const text = formatStatus(buildSnapshot(w.store, w.repo.main, 10), 10, "squeal");
    expect(text).not.toContain("Imported results from");
    expect(text).not.toContain("none current");
    const full = importLines(snapshot(imports));
    expect(full.filter((l) => l.startsWith("Imported: "))).toEqual([
      `Imported: 0 of 4 test files current from ${NEW_SOURCE} (0 current results)`,
      `Imported: 0 of 4 test files current from ${OLD_SOURCE} (0 current results)`,
    ]);
  });

  it("an older import whose environment blocks is not named once the newest works", () => {
    const w = worktree();
    const mac = { hash: "env-mac", descriptor: descriptor({ platform: "darwin", ci: true }) };
    importResults(
      w.store,
      bundle("1", OLD, mac, (p) => `k-mac-${p}`),
      {
        importId: "imp-old",
        fileHash: "h1",
        now: 5,
      },
    );
    expect(importDefaultLines(snapshot(w.imports()))).toHaveLength(1);
    const here = { hash: "env-dev", descriptor: descriptor() };
    importResults(
      w.store,
      bundle("2", NEW, here, (p) => `k-here-${p}`),
      {
        importId: "imp-new",
        fileHash: "h2",
        now: 6,
      },
    );
    expect(importDefaultLines(snapshot(w.imports()))).toEqual([]);
  });

  it("a field D10 accepts is never named; --full says why the old import's files are not current", () => {
    const w = worktree();
    squawk(w);
    const old = w.imports()[1];
    expect(old?.notCurrent.environment).toBe(4);
    expect(old?.environmentDifferences).toEqual([]);
    expect(old?.node).toBeUndefined();
    expect(importLines(snapshot(old === undefined ? [] : [old]))).toEqual([
      `Imported: 0 of 4 test files current from ${OLD_SOURCE} (0 current results)`,
      "  Not current: 4 environment differs (only in fields an imported pass may differ in, but the import kept the export's keys)",
    ]);
  });

  it("names only the differences that keep an imported pass apart, in the default line and --full", () => {
    const w = worktree();
    const config = { ...CI_CONFIG, pool: configFieldHash("threads") };
    const ci = { hash: "env-ci", descriptor: descriptor({ config, platform: "darwin", ci: true }) };
    importResults(
      w.store,
      bundle("1", OLD, ci, (p) => `k-ci-${p}`),
      {
        importId: "imp-old",
        fileHash: "h1",
        now: 5,
      },
    );
    const imports = w.imports();
    expect(imports[0]?.environmentDifferences).toEqual([
      "platform darwin in the export, linux here",
      "config fields pool differ",
    ]);
    expect(importDefaultLines(snapshot(imports))).toEqual([
      `Imported results from ${OLD_SOURCE}: 0 of 4 test files match this worktree; the environment differs for 4 (platform darwin in the export, linux here; config fields pool differ)`,
    ]);
    expect(importLines(snapshot(imports))[1]).toBe(
      "  Not current: 4 environment differs (platform darwin in the export, linux here; config fields pool differ)",
    );
  });

  it("the newest import is the one imported last, even of an older commit", () => {
    const w = worktree();
    squawk(w);
    const mac = { hash: "env-mac", descriptor: descriptor({ platform: "darwin", ci: true }) };
    importResults(
      w.store,
      bundle("3", OLD, mac, (p) => `k-mac-${p}`),
      {
        importId: "imp-late",
        fileHash: "h3",
        now: 7,
      },
    );
    expect(importDefaultLines(snapshot(w.imports()))).toEqual([
      "Imported results from CI run 3 on o/r at aaaaaaaa: 0 of 4 test files match this worktree; the environment differs for 4 (platform darwin in the export, linux here)",
    ]);
  });

  it("a file not adopted yet at the same key matches; silent when every file matches", () => {
    const w = worktree();
    const here = { hash: "env-dev", descriptor: descriptor() };
    importResults(
      w.store,
      bundle("2", NEW, here, (p) => `k-here-${p}`),
      {
        importId: "imp-new",
        fileHash: "h2",
        now: 6,
      },
    );
    const before = readImports(w.store, w.id, w.store.testFileKeys.list(w.id), []);
    expect(before[0]?.notCurrent).toMatchObject({ sameKeyKept: 3, sameKeyNotAdopted: 1 });
    expect(importDefaultLines(snapshot(before))).toEqual([]);
    expect(importDefaultLines(snapshot(w.imports()))).toEqual([]);
  });
});
