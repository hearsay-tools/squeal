import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { blobHash } from "../../src/core/hash/blob.js";
import {
  type FetchedPart,
  type ImportGraphSource,
  recordImportGraph,
} from "../../src/core/store/import-edges.js";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { SCHEMA_VERSION, userVersion } from "../../src/core/store/schema.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { FileImports, RunnerEnvironment } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open, tempDir, worktree } from "./helpers.js";

/*
 * Spec 015 D11 "New stored data" (row 015-108): import edges by the
 * importer's content, and each project's environment files by its hash,
 * written as a daemon's runner part does and read as `squeal reach` will.
 */

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const blob = (text: string) => blobHash(Buffer.from(text), "sha1");

/** One worktree on disk, its stat cache in `file_hashes` as its daemon flushed it. */
class Tree {
  readonly root = tempDir("squeal-import-graph-");
  readonly hashes = new Map<string, string>();
  environments = new Map<string, { hash: string; files: string[] }>();

  constructor(
    readonly store: Store,
    readonly id: string,
  ) {
    store.worktrees.upsert(worktree(id, this.root));
  }

  /** Writes `path` and records its stat and blob id, as a reconciliation does. */
  write(path: string, text: string, flush = true): void {
    const abs = join(this.root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    if (flush) this.flush(path, text);
  }

  flush(path: string, text: string): void {
    const s = lstatSync(join(this.root, path));
    const hash = blob(text);
    this.hashes.set(path, hash);
    this.store.fileHashes.upsertMany(this.id, [
      { path, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size, inode: s.ino, hash },
    ]);
  }

  source(): ImportGraphSource {
    return {
      store: this.store,
      root: this.root,
      worktreeId: this.id,
      now: () => 1_000,
      keys: {
        cache: { hashOf: (path) => this.hashes.get(path) },
        index: { environment: (project) => this.environments.get(project)?.hash },
        environmentFiles: (project) => this.environments.get(project)?.files ?? [],
      },
    };
  }

  record(fetched: FetchedPart): void {
    recordImportGraph(this.source(), fetched);
  }

  graph() {
    return readImportGraph(this.store, this.root, this.id);
  }
}

const imports = (
  path: string,
  text: string,
  targets: { static?: string[]; dynamic?: string[] },
): FileImports => ({
  path,
  sha1: sha1(text),
  static: targets.static ?? [],
  dynamic: targets.dynamic ?? [],
});

/** A runner closure of `test/a.test.ts` whose walk read `files`. */
const closure = (...files: FileImports[]): FetchedPart => ({
  closures: [{ testFile: { project: "", path: "test/a.test.ts" }, paths: [], imports: files }],
});

const environment = (project: string): RunnerEnvironment => ({
  project,
  runnerName: "vitest",
  runnerVersion: "5",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
});

const INDEX = 'export * from "./a.js";\nexport const load = () => import("./lazy.js");\n';

describe("import edges (015-108)", () => {
  it("records a file's targets with static and dynamic apart, under its blob id", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.write("src/index.ts", INDEX);
    tree.record(
      closure(imports("src/index.ts", INDEX, { static: ["src/a.ts"], dynamic: ["src/lazy.ts"] })),
    );

    expect(tree.graph().targets("src/index.ts")).toEqual({
      static: ["src/a.ts"],
      dynamic: ["src/lazy.ts"],
    });
    const rows = connectionOf(tree.store).all("SELECT path, hash FROM import_edges");
    expect(rows).toEqual([{ path: "src/index.ts", hash: blob(INDEX) }]);
  });

  it("shares a file's edges with every worktree at the same bytes, and only with those", () => {
    const store = open(fakeCommonDir());
    const one = new Tree(store, "w1");
    const two = new Tree(store, "w2");
    const three = new Tree(store, "w3");
    one.write("src/index.ts", INDEX);
    two.write("src/index.ts", INDEX);
    three.write("src/index.ts", `${INDEX}// other bytes\n`);
    one.record(closure(imports("src/index.ts", INDEX, { static: ["src/a.ts"] })));

    expect(two.graph().targets("src/index.ts")).toEqual({ static: ["src/a.ts"], dynamic: [] });
    expect(three.graph().targets("src/index.ts")).toBeUndefined();
  });

  it("reads a changed file as not recorded until its next walk", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.write("src/index.ts", INDEX);
    tree.record(closure(imports("src/index.ts", INDEX, { static: ["src/a.ts"] })));

    // Changed on disk, no daemon looked yet: the stat no longer matches the record.
    const edited = 'export * from "./b.js";\n';
    tree.write("src/index.ts", edited, false);
    expect(tree.graph().targets("src/index.ts")).toBeUndefined();
    // The daemon hashed it: the new blob id has no edges until the walk.
    tree.flush("src/index.ts", edited);
    expect(tree.graph().targets("src/index.ts")).toBeUndefined();

    tree.record(closure(imports("src/index.ts", edited, { static: ["src/b.ts"] })));
    expect(tree.graph().targets("src/index.ts")).toEqual({ static: ["src/b.ts"], dynamic: [] });
  });

  it("stores nothing for a walk of bytes the file no longer holds", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.write("src/index.ts", INDEX);
    // The walk read other bytes, then the file was written back before the store.
    tree.record(closure(imports("src/index.ts", "export {};\n", { static: ["src/gone.ts"] })));

    expect(tree.graph().targets("src/index.ts")).toBeUndefined();
    expect(connectionOf(tree.store).all("SELECT path FROM import_edges")).toEqual([]);
  });

  it("drops a path's versions no worktree holds when a new one is stored", () => {
    const store = open(fakeCommonDir());
    const one = new Tree(store, "w1");
    const two = new Tree(store, "w2");
    const versions = ["export const v = 1;\n", "export const v = 2;\n", "export const v = 3;\n"];
    two.write("src/v.ts", versions[0] as string);
    two.record(closure(imports("src/v.ts", versions[0] as string, {})));
    for (const text of versions) {
      one.write("src/v.ts", text);
      one.record(closure(imports("src/v.ts", text, {})));
    }

    const held = store.fileHashes.get("w2", "src/v.ts")?.hash;
    const rows = connectionOf(store).all("SELECT hash FROM import_edges ORDER BY hash");
    expect(rows.map((row) => row.hash).sort()).toEqual([held, blob(versions[2] as string)].sort());
    expect(two.graph().targets("src/v.ts")).toEqual({ static: [], dynamic: [] });
  });
});

describe("environment files (015-108)", () => {
  it("records each project's files under its environment hash and reads them back", () => {
    const store = open(fakeCommonDir());
    const one = new Tree(store, "w1");
    const two = new Tree(store, "w2");
    for (const tree of [one, two]) {
      tree.write("vitest.config.ts", "export default {};\n");
      tree.write("test/setup.ts", "globalThis.x = 1;\n");
      // A resolution candidate with no file is listed as absent.
      tree.environments.set("unit", {
        hash: "env-1",
        files: ["test/setup.ts", "test/setup/index.ts", "vitest.config.ts"],
      });
    }
    one.record({ environments: [environment("unit")] });
    two.record({ environments: [environment("unit")] });

    const files = ["test/setup.ts", "test/setup/index.ts", "vitest.config.ts"];
    expect(one.graph().environment("unit")).toEqual(files);
    expect(two.graph().environment("unit")).toEqual(files);
    expect(one.graph().environment("e2e")).toBeUndefined();
    expect(connectionOf(store).all("SELECT project, environment FROM environment_files")).toEqual([
      { project: "unit", environment: "env-1" },
    ]);
  });

  it("reads a list as not recorded once one of its files changed or appeared", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.write("test/setup.ts", "globalThis.x = 1;\n");
    tree.environments.set("unit", { hash: "env-1", files: ["test/setup.ts", "test/setup.js"] });
    tree.record({ environments: [environment("unit")] });
    expect(tree.graph().environment("unit")).toEqual(["test/setup.ts", "test/setup.js"]);

    tree.write("test/setup.ts", "globalThis.x = 2;\n");
    expect(tree.graph().environment("unit")).toBeUndefined();
    tree.write("test/setup.ts", "globalThis.x = 1;\n");
    expect(tree.graph().environment("unit")).toEqual(["test/setup.ts", "test/setup.js"]);
    tree.write("test/setup.js", "// appeared\n", false);
    expect(tree.graph().environment("unit")).toBeUndefined();
  });

  it("moves a worktree to its new hash and drops the lists no worktree reads", () => {
    const tree = new Tree(open(fakeCommonDir()), "w1");
    tree.write("test/setup.ts", "globalThis.x = 1;\n");
    tree.environments.set("unit", { hash: "env-1", files: ["test/setup.ts"] });
    tree.record({ environments: [environment("unit")] });
    tree.environments.set("unit", { hash: "env-2", files: ["test/setup.ts", "vitest.config.ts"] });
    tree.write("vitest.config.ts", "export default {};\n");
    tree.record({ environments: [environment("unit")] });

    expect(tree.graph().environment("unit")).toEqual(["test/setup.ts", "vitest.config.ts"]);
    const rows = connectionOf(tree.store).all("SELECT environment FROM environment_files");
    expect(rows).toEqual([{ environment: "env-2" }]);
  });
});

describe("the main store's schema (015-108)", () => {
  it("reads nothing from a store no daemon of this version wrote, and keeps its user_version", () => {
    const commonDir = fakeCommonDir();
    const tree = new Tree(open(commonDir), "w1");
    tree.write("src/index.ts", INDEX);
    expect(tree.graph().targets("src/index.ts")).toBeUndefined();
    expect(tree.graph().environment("unit")).toBeUndefined();
    const tables = () =>
      connectionOf(tree.store)
        .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .map((row) => row.name);
    expect(tables()).not.toContain("import_edges");

    tree.record(closure(imports("src/index.ts", INDEX, { static: ["src/a.ts"] })));
    expect(tables()).toEqual(expect.arrayContaining(["import_edges", "environment_files"]));
    expect(userVersion(connectionOf(tree.store).db)).toBe(SCHEMA_VERSION);
    // Opened again, as an older daemon of the same schema opens it: unchanged.
    expect(userVersion(connectionOf(open(commonDir)).db)).toBe(SCHEMA_VERSION);
  });

  it("stores nothing, and throws nothing, through a store not opened by openStore", () => {
    const store = open(fakeCommonDir());
    const tree = new Tree(store, "w1");
    tree.write("src/index.ts", INDEX);
    const wrapped = new Proxy(store, {});
    recordImportGraph(
      { ...tree.source(), store: wrapped },
      closure(imports("src/index.ts", INDEX, {})),
    );
    expect(
      connectionOf(store).all("SELECT name FROM sqlite_master WHERE name = 'import_edges'"),
    ).toEqual([]);
  });
});
