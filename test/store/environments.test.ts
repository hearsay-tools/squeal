import { describe, expect, it } from "vitest";
import type { EnvironmentDescriptor } from "../../src/core/keys/environment-descriptor.js";
import {
  putEnvironments,
  readEnvironment,
  recordWorktreeEnvironments,
  worktreeEnvironment,
  worktreeEnvironments,
} from "../../src/core/store/environments.js";
import { SCHEMA_VERSION, userVersion } from "../../src/core/store/schema.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Spec 018 D1, storage: each environment hash's parts by hash, and the hash
 * each worktree keys each project with now, in tables the first write makes.
 */

const W1 = "aaaaaaaaaaaaaaaa";
const W2 = "bbbbbbbbbbbbbbbb";

function descriptor(nodeVersion: string, project = ""): EnvironmentDescriptor {
  return {
    keyFormat: 21,
    project,
    runnerName: "vitest",
    runnerVersion: "5.0.3",
    adapterVersion: "7",
    nodeVersion,
    platform: "linux",
    arch: "x64",
    installedDependencies: "none",
    env: { names: [], hash: "e".repeat(64) },
    config: { allowOnly: "c".repeat(64) },
    files: [["vitest.config.ts", "1".repeat(40)]],
    ci: false,
  };
}

const tables = (store: Store): string[] =>
  connectionOf(store)
    .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((row) => String(row.name));

describe("environment records (018 D1)", () => {
  it("reads nothing before the first write, which makes the tables without a schema raise", () => {
    const store = open(fakeCommonDir());
    expect(readEnvironment(store, "h1")).toBeNull();
    expect(worktreeEnvironments(store, W1)).toEqual([]);
    expect(worktreeEnvironment(store, W1, "")).toBeNull();
    expect(tables(store)).not.toContain("environments");

    recordWorktreeEnvironments(
      store,
      W1,
      [{ hash: "h1", descriptor: descriptor("v24.22.1") }],
      1000,
    );
    expect(tables(store)).toEqual(
      expect.arrayContaining(["environments", "worktree_environment_hashes"]),
    );
    expect(userVersion(connectionOf(store).db)).toBe(SCHEMA_VERSION);
  });

  it("reads each worktree's hash per project with its descriptor", () => {
    const store = open(fakeCommonDir());
    recordWorktreeEnvironments(
      store,
      W1,
      [
        { hash: "h-web", descriptor: descriptor("v24.22.1", "web") },
        { hash: "h-api", descriptor: descriptor("v24.22.1", "api") },
      ],
      1000,
    );
    recordWorktreeEnvironments(
      store,
      W2,
      [{ hash: "h-2", descriptor: descriptor("v26.13.0", "web") }],
      2000,
    );

    expect(worktreeEnvironments(store, W1).map((e) => [e.project, e.hash])).toEqual([
      ["api", "h-api"],
      ["web", "h-web"],
    ]);
    expect(worktreeEnvironment(store, W2, "web")).toEqual({
      project: "web",
      hash: "h-2",
      descriptor: descriptor("v26.13.0", "web"),
      recordedAt: 2000,
    });
    expect(readEnvironment(store, "h-api")).toEqual(descriptor("v24.22.1", "api"));
    expect(worktreeEnvironment(store, W2, "api")).toBeNull();
  });

  it("moves a project's hash, keeps the old descriptor, and drops a project no longer read", () => {
    const store = open(fakeCommonDir());
    const both = [
      { hash: "h1", descriptor: descriptor("v24.22.1", "web") },
      { hash: "h-api", descriptor: descriptor("v24.22.1", "api") },
    ];
    recordWorktreeEnvironments(store, W1, both, 1000);
    recordWorktreeEnvironments(store, W1, both, 1500);
    expect(worktreeEnvironment(store, W1, "web")?.recordedAt).toBe(1000);

    recordWorktreeEnvironments(
      store,
      W1,
      [{ hash: "h2", descriptor: descriptor("v26.13.0", "web") }],
      2000,
    );
    expect(worktreeEnvironments(store, W1).map((e) => [e.project, e.hash, e.recordedAt])).toEqual([
      ["web", "h2", 2000],
    ]);
    expect(readEnvironment(store, "h1")).toEqual(descriptor("v24.22.1", "web"));
  });

  it("keeps a hash's descriptor as first written", () => {
    const store = open(fakeCommonDir());
    putEnvironments(store, [{ hash: "h1", descriptor: descriptor("v24.22.1") }], 1000);
    putEnvironments(
      store,
      [{ hash: "h1", descriptor: { ...descriptor("v24.22.1"), ci: true } }],
      2000,
    );
    expect(readEnvironment(store, "h1")?.ci).toBe(false);
  });

  it("reads a descriptor of another shape as none", () => {
    const store = open(fakeCommonDir());
    recordWorktreeEnvironments(
      store,
      W1,
      [{ hash: "h1", descriptor: descriptor("v24.22.1") }],
      1000,
    );
    connectionOf(store).run(
      "UPDATE environments SET descriptor = ? WHERE hash = 'h1'",
      '{"node":1}',
    );
    expect(readEnvironment(store, "h1")).toBeNull();
    expect(worktreeEnvironment(store, W1, "")?.descriptor).toBeNull();
  });

  it("writes beside 0.1.415's worktree_environments table of other columns", () => {
    const store = open(fakeCommonDir());
    connectionOf(store).db.exec(
      `CREATE TABLE worktree_environments (worktree_id TEXT NOT NULL, project TEXT NOT NULL,
       environment TEXT NOT NULL, PRIMARY KEY (worktree_id, project)) STRICT, WITHOUT ROWID`,
    );
    recordWorktreeEnvironments(
      store,
      W1,
      [{ hash: "h1", descriptor: descriptor("v24.22.1") }],
      1000,
    );
    expect(worktreeEnvironment(store, W1, "")?.hash).toBe("h1");
  });

  it("stores nothing in a store openStore did not open", () => {
    const fake = {} as Store;
    expect(() =>
      recordWorktreeEnvironments(
        fake,
        W1,
        [{ hash: "h1", descriptor: descriptor("v24.22.1") }],
        1000,
      ),
    ).not.toThrow();
  });
});
