import { describe, expect, it } from "vitest";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import {
  configFieldHash,
  type EnvironmentDescriptor,
} from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import {
  addMissingEntries,
  listedDirectory,
  namesHash,
  observedMetaKey,
} from "../../src/core/keys/observed.js";
import { recordWorktreeEnvironments } from "../../src/core/store/environments.js";
import { importFiles } from "../../src/core/store/imports.js";
import type { KeyParts, ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Spec 018 D11, the proof: an exported file re-keys only when its exported
 * key comes out of its own list over the export commit's files, with the
 * export's environment hash and the key parts it gives. Otherwise its
 * results stay at the exported key, as before (D3).
 */

const HERE = "0123456789abcdef";
const TEST = "t/a.test.ts";
const REF = { project: "", path: TEST };
const DATA = "data/value.txt";
const EXPORTED_LIST = ["src/a.ts", TEST];
const BLOBS: ReadonlyMap<string, string> = new Map([
  [TEST, "1".repeat(40)],
  ["src/a.ts", "2".repeat(40)],
  ["src/b.ts", "3".repeat(40)],
  [DATA, "4".repeat(40)],
]);
const PARTS: KeyParts = { dependencies: "deps-of-a", runtime: "" };
/** `allowOnly` as a descriptor holds it: CI rejects focused tests, a developer's run allows them. */
const STRICT = configFieldHash(false);
const FOCUS = configFieldHash(true);

function descriptor(config: Record<string, string>): EnvironmentDescriptor {
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
    config: { root: "r", ...config },
    files: [],
    ci: false,
    browser: false,
  };
}

/** The key of `paths` over `blobs`, as a daemon at the export's commit computes it. */
function keyAt(
  environment: string,
  paths: readonly string[],
  parts: KeyParts,
  blobs: ReadonlyMap<string, string> = BLOBS,
): string {
  const segments = paths.map((p) => encodeSegment(p, hashAt(p, blobs)));
  return keyFromSegments(environment, REF, segments, parts.dependencies, parts.runtime);
}

/** A file's blob id at the commit; a listing's entry names (`namesHash`). This file's lists list no nested directory. */
function hashAt(path: string, blobs: ReadonlyMap<string, string>): string | null {
  const directory = listedDirectory(path);
  if (directory === null) return blobs.get(path) ?? null;
  const prefix = `${directory}/`;
  return namesHash(
    [...blobs.keys()].flatMap((p) => (p.startsWith(prefix) ? [p.slice(prefix.length)] : [])),
  );
}

/** What the export held of its file beside the key: its list and observed entry. */
interface Exported {
  readonly ci?: EnvironmentDescriptor;
  readonly list?: readonly string[];
  readonly observed?: readonly string[];
}

/** CI's export of one file at `key`, with `parts` written or not. */
function bundle(key: string, parts?: KeyParts, exported: Exported = {}): ResultsBundle {
  const { ci = descriptor({ allowOnly: STRICT }), list = EXPORTED_LIST } = exported;
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      commit: "c".repeat(40),
      dirty: false,
      createdAt: 1,
      source: { kind: "local" },
    },
    environments: [{ project: "", hash: "env-ci", descriptor: ci }],
    testFiles: [
      {
        ...REF,
        key,
        closure: { paths: list, complete: true, method: METHOD },
        observed: exported.observed === undefined ? {} : { observed: exported.observed },
        ...(parts === undefined ? {} : { keyParts: parts }),
      },
    ],
    observedStartup: [],
    results: [
      {
        project: "",
        testPath: TEST,
        kind: "test",
        fullName: "passes",
        location: null,
        key,
        outcome: "pass",
        durationMs: 3,
      },
    ],
  };
}

const METHOD = "static imports plus declared inputs" as const;

/** What this store held of the file before the import: a list of its own, and its observed entry. */
interface Held {
  readonly list?: readonly string[];
  readonly observed: readonly string[];
}

/**
 * This worktree: its environment differs from CI's by `allowOnly` only (CI
 * strict, here focused tests allowed); its union adds `src/b.ts` to the list
 * the import stores, unless `held` names what the store held already.
 */
function here(
  local = descriptor({ allowOnly: FOCUS }),
  held: Held = { observed: ["src/b.ts"] },
): Store {
  const store = open(fakeCommonDir());
  recordWorktreeEnvironments(store, HERE, [{ hash: "env-here", descriptor: local }], 1);
  store.transaction(() => {
    if (held.list !== undefined) {
      const closure = { testFile: REF, paths: held.list, complete: true, method: METHOD };
      store.testFiles.put({ testFile: REF, closure, updatedAt: 1, updatedBy: HERE });
    }
    addMissingEntries(store, observedMetaKey(""), { [TEST]: held.observed });
  });
  return store;
}

function imported(
  store: Store,
  b: ResultsBundle,
  blobs: ReadonlyMap<string, string> | null = BLOBS,
) {
  return importResults(store, b, {
    importId: "imp",
    fileHash: "h",
    now: 10,
    rekeying: { worktreeId: HERE, blobs },
  });
}

/** The local key: this worktree's list (the export's, which the import stored, plus its union). */
const LOCAL_LIST = ["src/a.ts", "src/b.ts", TEST];

describe("re-keying an import needs the exported key as proof (018 D11)", () => {
  it("re-keys with the export's key parts, here's environment and list over the commit", () => {
    const store = here();
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS);
    expect(imported(store, bundle(exported, PARTS))).toMatchObject({ results: 1, rekeyed: 1 });
    const local = keyAt("env-here", LOCAL_LIST, PARTS);
    expect(store.results.byKey(local, 0)).toHaveLength(1);
    expect(store.results.byKey(exported, 0)).toEqual([]);
    expect(importFiles(store, "imp")).toMatchObject([{ key: local, environment: "env-here" }]);
  });

  it("keeps the exported key when the export gives no parts and the key had some", () => {
    const store = here();
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS);
    expect(imported(store, bundle(exported))).toMatchObject({ results: 1, rekeyed: 0 });
    expect(store.results.byKey(exported, 0)).toHaveLength(1);
    expect(importFiles(store, "imp")).toMatchObject([{ key: exported, environment: "env-ci" }]);
  });

  it("keeps the exported key when the export keyed a file its commit lacks (a build output)", () => {
    const store = here();
    const built = new Map([...BLOBS, ["src/a.ts", "9".repeat(40)]]);
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS, built);
    expect(imported(store, bundle(exported, PARTS))).toMatchObject({ rekeyed: 0 });
    expect(store.results.byKey(exported, 0)).toHaveLength(1);
  });

  it("keeps the exported key when this repository does not hold the commit", () => {
    const store = here();
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS);
    expect(imported(store, bundle(exported, PARTS), null)).toMatchObject({ rekeyed: 0 });
    expect(store.results.byKey(exported, 0)).toHaveLength(1);
  });

  it("keeps the exported key when the environment differs beyond D10's fields", () => {
    const store = here(descriptor({ allowOnly: FOCUS, root: "elsewhere" }));
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS);
    expect(imported(store, bundle(exported, PARTS))).toMatchObject({ rekeyed: 0 });
    expect(store.results.byKey(exported, 0)).toHaveLength(1);
  });

  it("keeps the exported key before this worktree recorded an environment", () => {
    const store = open(fakeCommonDir());
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS);
    expect(imported(store, bundle(exported, PARTS))).toMatchObject({ rekeyed: 0 });
    expect(store.results.byKey(exported, 0)).toHaveLength(1);
  });
});

/*
 * Review wave-5 B1: a re-key may only add inputs to the exported key, never
 * drop one. When this worktree's list lacks a path the exported run read
 * (a file, a listing, a static input), an edit of that path here would
 * leave the imported pass current. The results stay at the exported key.
 */
describe("re-keying keeps every input the exported run read (018 D11, review wave-5 B1)", () => {
  for (const [name, held, exported] of [
    [
      "an empty observed entry (an older version read no data file)",
      { list: [TEST], observed: [] },
      { list: [DATA, TEST], observed: [DATA] },
    ],
    [
      "an observed entry disjoint from the export's",
      { list: [TEST], observed: ["data/other.txt"] },
      { list: [DATA, TEST], observed: [DATA] },
    ],
    [
      "a list without a static input the export keyed",
      { list: [TEST], observed: ["src/b.ts"] },
      { list: EXPORTED_LIST },
    ],
    [
      "an observed entry without a listing the export read",
      { list: [TEST], observed: [DATA] },
      { list: ["data/", DATA, TEST], observed: ["data/", DATA] },
    ],
  ] as const) {
    it(`keeps the exported key over ${name}`, () => {
      const store = here(undefined, held);
      const exportedKey = keyAt("env-ci", exported.list, PARTS);
      expect(imported(store, bundle(exportedKey, PARTS, exported))).toMatchObject({ rekeyed: 0 });
      expect(store.results.byKey(exportedKey, 0)).toHaveLength(1);
      // The key a daemon here computes, over its own list: the same at any content of the missing path.
      const list = [...new Set([...held.list, ...held.observed])].sort();
      expect(store.results.byKey(keyAt("env-here", list, PARTS), 0)).toEqual([]);
    });
  }

  it("re-keys over a list here that holds every exported path and more", () => {
    const store = here(undefined, { list: [TEST], observed: ["data/", DATA, "src/b.ts"] });
    const exported = { list: ["data/", DATA, TEST], observed: ["data/", DATA] };
    const exportedKey = keyAt("env-ci", exported.list, PARTS);
    expect(imported(store, bundle(exportedKey, PARTS, exported))).toMatchObject({ rekeyed: 1 });
    const local = keyAt("env-here", ["data/", DATA, "src/b.ts", TEST], PARTS);
    expect(store.results.byKey(local, 0)).toHaveLength(1);
  });
});

/*
 * Review wave-5 B2: a pass made with focused tests allowed says nothing of a
 * run here that rejects them, since a file with `it.only` fails there. Only
 * an export made with `allowOnly: false` re-keys to a worktree with `true`.
 */
describe("re-keying tolerates allowOnly in one direction (018 D10, review wave-5 B2)", () => {
  it("keeps the exported key when the export allowed focused tests and this worktree rejects them", () => {
    const store = here(descriptor({ allowOnly: STRICT }));
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS);
    const ci = descriptor({ allowOnly: FOCUS });
    expect(imported(store, bundle(exported, PARTS, { ci }))).toMatchObject({ rekeyed: 0 });
    expect(store.results.byKey(exported, 0)).toHaveLength(1);
    expect(store.results.byKey(keyAt("env-here", LOCAL_LIST, PARTS), 0)).toEqual([]);
  });

  it("keeps the exported key when the export's allowOnly is unknown", () => {
    const store = here();
    const exported = keyAt("env-ci", EXPORTED_LIST, PARTS);
    expect(imported(store, bundle(exported, PARTS, { ci: descriptor({}) }))).toMatchObject({
      rekeyed: 0,
    });
    expect(store.results.byKey(exported, 0)).toHaveLength(1);
  });
});
