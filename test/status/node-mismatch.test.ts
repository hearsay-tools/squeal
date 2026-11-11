import { describe, expect, it, vi } from "vitest";
import type { EnvironmentDescriptor } from "../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { readImports } from "../../src/core/status/imports.js";
import {
  nodeMismatchLines,
  type PinnedNode,
  sharedOf,
} from "../../src/core/status/node-mismatch.js";
import { buildSnapshot } from "../../src/core/status/snapshot.js";
import { recordWorktreeEnvironments } from "../../src/core/store/environments.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { ImportStatus, NodeMismatch } from "../../src/core/types/status.js";
import { fakeRepo, seedStore } from "./helpers.js";

/*
 * Spec 018 D19: with `shared.ref` set, status says once that the newest
 * import's results need another Node than the daemon runs, why the daemon
 * does not run the project's pin (D18), and what to do; an import that
 * differs only in Node gets no D5 line of its own, another names no Node
 * there (row 018-32). Silent when Node matches.
 */

const COMMIT = "c".repeat(40);
const HERE_NODE = "v24.22.1";
const CI_NODE = "v26.13.0";
const PATHS = ["t/a.test.ts", "t/b.test.ts"];

function descriptor(parts: Partial<EnvironmentDescriptor> = {}): EnvironmentDescriptor {
  return {
    keyFormat: KEY_FORMAT_VERSION,
    project: "",
    runnerName: "vitest",
    runnerVersion: "4.0.0",
    adapterVersion: "1",
    nodeVersion: HERE_NODE,
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

/** CI's export of `PATHS`, recorded in the environment `ci` describes. */
function bundle(hash: string, ci: Partial<EnvironmentDescriptor>, runId = "77"): ResultsBundle {
  const testFiles = PATHS.map((path) => ({
    project: "",
    path,
    key: `k-${path}-${hash}`,
    closure: { paths: [path], complete: true, method: "static imports plus declared inputs" },
    observed: {},
  }));
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
    environments: [{ project: "", hash, descriptor: descriptor(ci) }],
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

/** A worktree that keys `PATHS` in the environment `local` describes. */
function worktree(local: Partial<EnvironmentDescriptor> = {}) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  recordWorktreeEnvironments(
    store,
    repo.mainId,
    [{ hash: "env-dev", descriptor: descriptor(local) }],
    1,
  );
  store.testFileKeys.upsertMany(
    PATHS.map((path) => ({
      worktreeId: repo.mainId,
      testFile: { project: "", path },
      key: `k-${path}-here`,
      revision: 1,
      pending: null,
    })),
  );
  const imported = (hash: string, ci: Partial<EnvironmentDescriptor>, now: number) =>
    importResults(store, bundle(hash, ci, String(now)), {
      importId: `imp-${now}`,
      fileHash: `h-${now}`,
      now,
    });
  const imports = (): ImportStatus[] =>
    readImports(store, repo.mainId, store.testFileKeys.list(repo.mainId), []);
  return { repo, store, imported, imports };
}

const PINS: readonly (readonly [string, PinnedNode, string])[] = [
  [
    "no pin",
    { reason: "none" },
    "The project pins no Node version: put 26.13.0 in .node-version, then restart the daemon (`squeal stop`, then `squeal start`).",
  ],
  [
    "a range",
    { reason: "range", wanted: "lts/*" },
    'The project\'s Node pin "lts/*" is not one exact version: pin 26.13.0 in .node-version or .nvmrc, then restart the daemon (`squeal stop`, then `squeal start`).',
  ],
  [
    "a version older than Squeal supports",
    { reason: "too-old", wanted: "v20.11.0" },
    "The project pins Node 20.11.0, older than Squeal supports, so the daemon runs the session's Node: pin 26.13.0 in .node-version or .nvmrc, then restart the daemon (`squeal stop`, then `squeal start`).",
  ],
  [
    "a version not installed",
    { reason: "missing", wanted: "v26.13.0" },
    "The project pins Node 26.13.0, which is not installed here: install it, then restart the daemon (`squeal stop`, then `squeal start`).",
  ],
  [
    'node: "session"',
    { reason: "session" },
    'squeal.config.json sets "node": "session", so the daemon runs the session\'s Node: start the session on v26.13.0, or remove that setting to use the project\'s pin.',
  ],
  [
    "a pin the daemon started before",
    { binary: "/n/v26.13.0/bin/node", version: "26.13.0" },
    "The project's pinned Node 26.13.0 is installed, but the daemon started on another: restart the daemon (`squeal stop`, then `squeal start`).",
  ],
  [
    "a pin the daemon runs, CI on another",
    { binary: "/n/v24.22.1/bin/node", version: "24.22.1" },
    "The daemon runs the project's pinned Node; CI recorded the results on another version: pin the same version in CI.",
  ],
];

const HEAD = `Shared results need Node ${CI_NODE}; the daemon runs ${HERE_NODE}, so 2 imported test files cannot count here.`;

describe("each import names its Node when it differs (018 D19)", () => {
  it("Node alone, or with a field an imported pass may differ in, is Node only", () => {
    const w = worktree();
    w.imported(
      "env-ci",
      { nodeVersion: CI_NODE, ci: true, config: { allowOnly: "a", watch: "w" } },
      5,
    );
    expect(w.imports()[0]?.node).toEqual({ exported: CI_NODE, here: HERE_NODE, only: true });
  });

  it("Node with another part is not Node only; another part alone names no Node", () => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE, platform: "darwin" }, 5);
    w.imported("env-arm", { arch: "arm64" }, 6);
    const [arm, ci] = w.imports();
    expect(ci?.node).toEqual({ exported: CI_NODE, here: HERE_NODE, only: false });
    expect(arm?.node).toBeUndefined();
  });

  it("node:test's build of Node goes with its version", () => {
    const local = { runnerName: "node-test", config: { nodeBuild: "b24" } };
    const w = worktree(local);
    w.imported("env-ci", { ...local, nodeVersion: CI_NODE, config: { nodeBuild: "b26" } }, 5);
    w.imported("env-build", { ...local, config: { nodeBuild: "b24-other" } }, 6);
    const [build, ci] = w.imports();
    expect(ci?.node).toEqual({ exported: CI_NODE, here: HERE_NODE, only: true });
    expect(build?.node).toBeUndefined();
  });
});

describe("status says a Node mismatch of shared results once (018 D19)", () => {
  it.each(PINS)("names both versions and why the pin was not used: %s", (_, pin, why) => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE }, 5);
    const { shared } = sharedOf("refs/squeal", w.imports(), () => pin);
    expect(nodeMismatchLines(shared, "squeal")).toEqual([`${HEAD} ${why}`]);
  });

  it("without shared.ref, or with the newest import on the daemon's Node, it says nothing and reads no pin", () => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE }, 5);
    const pin = vi.fn((): PinnedNode => ({ reason: "none" }));
    expect(sharedOf(null, w.imports(), pin)).toEqual({});
    w.imported("env-dev", {}, 6);
    expect(sharedOf("refs/squeal", w.imports(), pin)).toEqual({ shared: { ref: "refs/squeal" } });
    expect(sharedOf("refs/squeal", [], pin)).toEqual({ shared: { ref: "refs/squeal" } });
    expect(pin).not.toHaveBeenCalled();
    expect(nodeMismatchLines({ ref: "refs/squeal" }, "squeal")).toEqual([]);
  });

  it("counts the imports that differ only in Node", () => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE }, 5);
    w.imported("env-ci2", { nodeVersion: CI_NODE, ci: true }, 6);
    const shared = sharedOf("refs/squeal", w.imports(), () => ({ reason: "none" })).shared;
    expect(shared?.node).toEqual<NodeMismatch>({
      needed: CI_NODE,
      daemon: HERE_NODE,
      pin: { state: "none" },
      testFiles: 2,
      imports: 2,
    });
    expect(nodeMismatchLines(shared, "squeal")[0]).toContain(
      "cannot count here (2 imports differ only in Node). ",
    );
  });
});

describe("the default status text (018 D5, D19)", () => {
  const D5_LINE =
    "Imported results from CI run 5 on o/r at cccccccc: 0 of 2 test files match this worktree";

  /** The default text, with the snapshot's `shared` part as status builds it for `ref`. */
  function text(w: ReturnType<typeof worktree>, ref: string | null): string {
    const snapshot = buildSnapshot(w.store, w.repo.main, 10);
    const shared = sharedOf(ref, snapshot.imports ?? [], () => ({ reason: "none" }));
    return formatStatus({ ...snapshot, ...shared }, 10, "squeal");
  }

  it("a Node-only import: the Node line, and no line of the import's own", () => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE }, 5);
    const status = text(w, "refs/squeal");
    expect(status).toContain(`\n${HEAD} The project pins no Node version`);
    expect(status).not.toContain("Imported results from");
  });

  it("Node and another part: the Node line, and the import's own line without Node (row 018-32)", () => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE, platform: "darwin" }, 5);
    const status = text(w, "refs/squeal");
    expect(status).toContain(HEAD);
    expect(status).toContain(
      `\n${D5_LINE}; the environment differs for 2 (platform darwin in the export, linux here)\n`,
    );
    expect(status.split(`Node ${CI_NODE} in the export`)).toHaveLength(1);
  });

  it("without shared.ref the import's own line stays and Node is not said apart", () => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE }, 5);
    const status = text(w, null);
    expect(status).toContain(
      `${D5_LINE}; the environment differs for 2 (Node ${CI_NODE} in the export, ${HERE_NODE} here)`,
    );
    expect(status).not.toContain("Shared results need");
  });

  it("an older import on another Node is not named once the newest is on the daemon's", () => {
    const w = worktree();
    w.imported("env-ci", { nodeVersion: CI_NODE }, 5);
    w.imported("env-dev", {}, 6);
    const status = text(w, "refs/squeal");
    expect(status).not.toContain("Shared results need");
    expect(status).not.toContain("CI run 5");
    expect(status).toContain(
      "\nImported results from CI run 6 on o/r at cccccccc: 0 of 2 test files match this worktree\n",
    );
  });
});
