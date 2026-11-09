import { describe, expect, it } from "vitest";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import type { EnvironmentDescriptor } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { addMissingEntries, observedMetaKey } from "../../src/core/keys/observed.js";
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
const EXPORTED_LIST = ["src/a.ts", TEST];
const BLOBS: ReadonlyMap<string, string> = new Map([
  [TEST, "1".repeat(40)],
  ["src/a.ts", "2".repeat(40)],
  ["src/b.ts", "3".repeat(40)],
]);
const PARTS: KeyParts = { dependencies: "deps-of-a", runtime: "" };

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
  const segments = paths.map((p) => encodeSegment(p, blobs.get(p) ?? null));
  return keyFromSegments(environment, REF, segments, parts.dependencies, parts.runtime);
}

/** CI's export of one file at `key`, with `parts` written or not. */
function bundle(key: string, parts?: KeyParts, ci = descriptor({ allowOnly: "f" })): ResultsBundle {
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
        closure: {
          paths: EXPORTED_LIST,
          complete: true,
          method: "static imports plus declared inputs",
        },
        observed: {},
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

/** This worktree: its environment differs from CI's by `allowOnly` only; its union adds `src/b.ts`. */
function here(local = descriptor({ allowOnly: "t" })): Store {
  const store = open(fakeCommonDir());
  recordWorktreeEnvironments(store, HERE, [{ hash: "env-here", descriptor: local }], 1);
  store.transaction(() => addMissingEntries(store, observedMetaKey(""), { [TEST]: ["src/b.ts"] }));
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
    const store = here(descriptor({ allowOnly: "t", root: "elsewhere" }));
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
