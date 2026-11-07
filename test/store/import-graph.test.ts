import { describe, expect, it } from "vitest";
import { assembleClosure } from "../../src/core/keys/closure.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { storeClosures } from "../../src/core/scheduler/revision.js";
import {
  type FetchedPart,
  type ImportGraphSource,
  recordImportGraph,
} from "../../src/core/store/import-edges.js";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { SCHEMA_VERSION, userVersion } from "../../src/core/store/schema.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { FileImports, RunnerEnvironment } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open, tempDir, worktree } from "./helpers.js";

/*
 * Spec 015 D11 "New stored data" under R2's rule (review 0.1.415-r2):
 * stored import edges belong to a test file's result key. A walk is
 * written with the closure its key was set from, and read only while that
 * key is the worktree's current key for the file; setup and config walks
 * are read only through a key row, at the environment hash it names.
 */

const T: TestFileRef = { project: "", path: "test/a.test.ts" };

/** One worktree whose daemon keyed its test files: its current keys, and each project's hash. */
class Tree {
  readonly keys = new Map<string, string>();
  readonly environments = new Map<string, { hash: string; files: string[] }>([
    ["", { hash: "env-1", files: [] }],
  ]);

  constructor(
    readonly store: Store,
    readonly id: string,
  ) {
    store.worktrees.upsert(worktree(id, tempDir("squeal-import-graph-")));
  }

  /** The worktree's current key for `ref`, as its daemon stores it. */
  key(ref: TestFileRef, key: string | null): void {
    if (key === null) this.keys.delete(`${ref.project}\0${ref.path}`);
    else this.keys.set(`${ref.project}\0${ref.path}`, key);
    this.store.testFileKeys.upsertMany([
      { worktreeId: this.id, testFile: ref, key, revision: 1, pending: null },
    ]);
  }

  source(): ImportGraphSource {
    return {
      store: this.store,
      now: () => 1_000,
      keys: {
        index: {
          environment: (project) => this.environments.get(project)?.hash,
          key: (ref) => this.keys.get(`${ref.project}\0${ref.path}`) ?? null,
        },
        environmentFiles: (project) => this.environments.get(project)?.files ?? [],
      },
    };
  }

  record(fetched: FetchedPart): void {
    recordImportGraph(this.source(), fetched);
  }

  graph() {
    return readImportGraph(this.store, this.id);
  }
}

const imports = (
  path: string,
  targets: { static?: string[]; dynamic?: string[] },
): FileImports => ({
  path,
  sha1: "walked",
  static: targets.static ?? [],
  dynamic: targets.dynamic ?? [],
});

/** A runner closure of `ref` whose walk read `files`. */
const closure = (ref: TestFileRef, ...files: FileImports[]): FetchedPart => ({
  closures: [{ testFile: ref, paths: [], imports: files }],
});

const environment = (
  project: string,
  extra: Partial<RunnerEnvironment> = {},
): RunnerEnvironment => ({
  project,
  runnerName: "vitest",
  runnerVersion: "5",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
  ...extra,
});

const targetsOf = (tree: Tree, path: string, ref = T) => tree.graph().walk(ref)?.imports.get(path);

describe("walks by result key (R2)", () => {
  it("writes a closure's walk under its test file's key, static and dynamic apart, and reads it while that key is current", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.key(T, "key-1");
    tree.record(
      closure(T, imports("src/index.ts", { static: ["src/a.ts"], dynamic: ["src/lazy.ts"] })),
    );

    expect(targetsOf(tree, "src/index.ts")).toEqual({
      static: ["src/a.ts"],
      dynamic: ["src/lazy.ts"],
    });
    const rows = connectionOf(tree.store).all(
      "SELECT project, path, key, environment FROM test_file_imports",
    );
    expect(rows).toEqual([{ project: "", path: T.path, key: "key-1", environment: "env-1" }]);
  });

  it("shares a walk with every worktree at the same key, and gives none to a worktree at another", () => {
    const store = open(fakeCommonDir());
    const one = new Tree(store, "w1");
    const same = new Tree(store, "w2");
    const other = new Tree(store, "w3");
    one.key(T, "key-1");
    same.key(T, "key-1");
    other.key(T, "key-2");
    one.record(closure(T, imports("src/gateway.ts", { static: ["src/leaf.ts"] })));

    expect(targetsOf(same, "src/gateway.ts")?.static).toEqual(["src/leaf.ts"]);
    expect(other.graph().walk(T)).toBeUndefined();
    // Another key's walk never replaces it: each key owns its own.
    other.record(closure(T, imports("src/gateway.ts", { static: ["src/leaf.js"] })));
    expect(targetsOf(one, "src/gateway.ts")?.static).toEqual(["src/leaf.ts"]);
    expect(targetsOf(other, "src/gateway.ts")?.static).toEqual(["src/leaf.js"]);
  });

  it("reads none once the worktree's key moved, until a walk is written with the new key", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.key(T, "key-1");
    tree.record(closure(T, imports("src/index.ts", { static: ["src/a.ts"] })));
    tree.key(T, "key-2");
    expect(tree.graph().walk(T)).toBeUndefined();

    tree.record(closure(T, imports("src/index.ts", { static: ["src/b.ts"] })));
    expect(targetsOf(tree, "src/index.ts")?.static).toEqual(["src/b.ts"]);
    // No worktree holds key-1 now: its walk went with the new one.
    const keys = connectionOf(tree.store).all("SELECT key FROM test_file_imports");
    expect(keys).toEqual([{ key: "key-2" }]);
  });

  it("keeps a walk another worktree's key still holds", () => {
    const store = open(fakeCommonDir());
    const one = new Tree(store, "w1");
    const two = new Tree(store, "w2");
    one.key(T, "key-1");
    two.key(T, "key-1");
    one.record(closure(T, imports("src/index.ts", { static: ["src/a.ts"] })));
    one.key(T, "key-2");
    one.record(closure(T, imports("src/index.ts", { static: ["src/b.ts"] })));

    expect(targetsOf(two, "src/index.ts")?.static).toEqual(["src/a.ts"]);
  });

  it("writes nothing for a test file with no key", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.record(closure(T, imports("src/index.ts", {})));
    expect(tree.graph().walk(T)).toBeUndefined();
  });
});

describe("setup chains through the key row (R2)", () => {
  const config = imports("vitest.config.ts", { static: ["src/reporter.ts"] });
  const setup = imports("test/setup.ts", { static: ["src/env.ts"] });
  const unit = (roots: string[]) =>
    environment("", {
      roots,
      imports: [config, setup],
      files: ["test/setup.ts", "vitest.config.ts"],
    });

  it("reads a project's setup and config walks at the environment hash the test file's key names", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.environments.set("", { hash: "env-1", files: ["test/setup.ts", "vitest.config.ts"] });
    tree.record({ environments: [unit(["test/setup.ts", "vitest.config.ts"])] });
    tree.key(T, "key-1");
    tree.record(closure(T));

    const walked = tree.graph().walk(T)?.environment;
    expect(walked?.files).toEqual(["test/setup.ts", "vitest.config.ts"]);
    expect(walked?.roots).toEqual(["test/setup.ts", "vitest.config.ts"]);
    expect(walked?.imports.get("vitest.config.ts")?.static).toEqual(["src/reporter.ts"]);
    expect(walked?.imports.get("test/setup.ts")?.static).toEqual(["src/env.ts"]);
  });

  it("gives a key row whose environment walk was never stored no setup chain", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.key(T, "key-1");
    tree.record(closure(T));
    expect(tree.graph().walk(T)).toMatchObject({ environment: undefined });
  });

  it("drops the environment walks no key row names and no project reads now", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.record({ environments: [unit(["vitest.config.ts"])] });
    tree.key(T, "key-1");
    tree.record(closure(T));
    tree.environments.set("", { hash: "env-2", files: [] });
    tree.record({ environments: [unit(["vitest.config.ts"])] });
    tree.key(T, "key-2");
    tree.record(closure(T));

    const rows = connectionOf(tree.store).all("SELECT environment FROM environment_walks");
    expect(rows).toEqual([{ environment: "env-2" }]);
  });
});

describe("storeClosures (015-108, R2)", () => {
  it("stores the closures, and their walks under the keys just set, in one transaction", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.key(T, "key-1");
    const assembled = assembleClosure({ testFile: T, paths: ["src/index.ts"] }, []);
    const source = tree.source();
    const index = { ...source.keys.index, closure: () => assembled };
    const context = { ...source, worktreeId: tree.id, keys: { ...source.keys, index } };

    storeClosures(context as unknown as SchedulerContext, [T], {
      ...closure(T, imports("src/index.ts", { static: ["src/a.ts"] })),
      environments: [environment("")],
    });

    expect(tree.store.testFiles.get(T)?.closure.paths).toEqual(["src/index.ts", "test/a.test.ts"]);
    expect(targetsOf(tree, "src/index.ts")?.static).toEqual(["src/a.ts"]);
  });
});

describe("the main store's schema (015-108, R2)", () => {
  it("reads nothing from a store no daemon of this version wrote, and keeps its user_version", () => {
    const commonDir = fakeCommonDir();
    const tree = new Tree(open(commonDir), "w1");
    tree.key(T, "key-1");
    expect(tree.graph().walk(T)).toBeUndefined();
    const tables = () =>
      connectionOf(tree.store)
        .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .map((row) => row.name);
    expect(tables()).not.toContain("test_file_imports");

    tree.record(closure(T, imports("src/index.ts", { static: ["src/a.ts"] })));
    expect(tables()).toEqual(expect.arrayContaining(["test_file_imports", "environment_walks"]));
    expect(userVersion(connectionOf(tree.store).db)).toBe(SCHEMA_VERSION);
    // Opened again, as an older daemon of the same schema opens it: unchanged.
    expect(userVersion(connectionOf(open(commonDir)).db)).toBe(SCHEMA_VERSION);
  });

  it("stores nothing, and throws nothing, through a store not opened by openStore", () => {
    const store = open(fakeCommonDir());
    const tree = new Tree(store, "w1");
    tree.key(T, "key-1");
    recordImportGraph(
      { ...tree.source(), store: new Proxy(store, {}) },
      closure(T, imports("src/index.ts", {})),
    );
    expect(
      connectionOf(store).all("SELECT name FROM sqlite_master WHERE name = 'test_file_imports'"),
    ).toEqual([]);
  });
});
