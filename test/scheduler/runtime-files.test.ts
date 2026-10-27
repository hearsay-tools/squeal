import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { observedGrowth } from "../../src/core/scheduler/observed.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Policy,
  type RunReport,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";

const READERS = ["test/a.test.ts", "test/b.test.ts", "test/outside.test.ts"].map(
  (path): TestFileRef => ({ project: "browser", path }),
);
const RUNTIME = ".runtime/descriptor.json";
const POLICY: Policy = {
  ...DEFAULT_POLICY,
  runtimeFiles: [{ project: "browser", tests: ["test/{a,b}.test.ts"], paths: [RUNTIME] }],
};
let root: string;
let store: Store;
function write(path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-runtime-")));
  for (const ref of READERS) write(ref.path, "// test\n");
  write(".gitignore", ".runtime/\n");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  write(RUNTIME, "one\n");
  const opened = openStore(join(root, ".git"));
  if (isStoreOpenFailure(opened)) throw new Error(JSON.stringify(opened));
  store = opened;
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});
async function keyed(policy = POLICY, id = worktreeIdFor(root)) {
  const keys = new WorktreeKeys({
    root,
    worktreeId: id,
    store,
    hasher: createFsHasher(root, "sha1"),
    objectFormat: "sha1",
    policy,
    squealVersion: "0.0.0-test",
    env: {},
    onExtraFiles: () => {},
  });
  await keys.bootstrap(() => readHead(root));
  await keys.setEnvironments([
    {
      project: "browser",
      runnerName: "fixture",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig: "{}",
      files: [],
    },
  ]);
  for (const ref of READERS) {
    keys.setClosure({ testFile: ref, paths: [ref.path] });
    keys.addObserved(ref, [RUNTIME]);
  }
  await keys.trackUntracked();
  return keys;
}
describe("scoped runtime files", () => {
  it("keeps two scoped keys through rewrite/create/delete/atomic replace, and tracks the outside reader", async () => {
    const keys = await keyed();
    const original = READERS.map((ref) => keys.index.key(ref));
    for (const edit of [
      () => write(RUNTIME, "rewrite\n"),
      () => rmSync(join(root, RUNTIME)),
      () => write(RUNTIME, "created\n"),
      () => {
        write(`${RUNTIME}.tmp`, "atomic\n");
        renameSync(join(root, `${RUNTIME}.tmp`), join(root, RUNTIME));
      },
    ]) {
      const previous = keys.index.key(READERS[2] as TestFileRef);
      edit();
      const revision = await keys.reconcile(
        { trigger: "watch", paths: await statCandidates([RUNTIME], createFsHasher(root, "sha1")) },
        () => readHead(root),
      );
      keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);
      expect(READERS.slice(0, 2).map((ref) => keys.index.key(ref))).toEqual(original.slice(0, 2));
      expect(keys.index.key(READERS[2] as TestFileRef)).not.toBe(previous);
      expect(keys.extraFiles()).toContain(RUNTIME);
    }
  });
});

const A = READERS[0] as TestFileRef;
function report(paths: string[], modules: string[] = []): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: [A],
    results: [],
    fileErrors: [],
    failure: null,
    observed: [{ testFile: A, paths, modules, directories: [] }],
  };
}
it("persists a raw-only read across rollback, releases its watch, then restores it before lookup", async () => {
  const keys = await keyed();
  const fresh = ".runtime/new.json";
  write(fresh, "read\n");
  keys.setPolicy({
    ...POLICY,
    runtimeFiles: [{ project: A.project, tests: [A.path], paths: [RUNTIME, fresh] }],
  });
  await keys.trackUntracked();
  const before = keys.index.key(A);
  const found = [
    ...(await observedGrowth({ root, keys }, report([fresh]), keys.beginRun())).values(),
  ][0];
  expect(found).toMatchObject({ add: [fresh], growth: [], firstSeen: [] });
  keys.addObserved(A, found?.add ?? []);
  expect(keys.index.key(A)).toBe(before);
  expect(keys.extraFiles()).not.toContain(fresh);
  expect(() =>
    store.transaction(() => {
      keys.writeSeen();
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  expect(store.meta.get(observedMetaKey(A.project))).toBeNull();
  store.transaction(() => keys.writeSeen());
  expect(JSON.parse(store.meta.get(observedMetaKey(A.project)) ?? "{}")[A.path]).toContain(fresh);
  keys.setPolicy(DEFAULT_POLICY);
  expect(keys.index.key(A)).toBeNull();
  await keys.trackUntracked();
  expect(keys.index.key(A)).not.toBeNull();
  expect(keys.extraFiles()).toContain(fresh);
  expect(keys.index.closure(A)?.paths).toContain(fresh);
});
it("uses a sorted deterministic contract for absent files and refuses all old aliases", async () => {
  const absent = ".runtime/absent.json";
  const unscoped = await keyed(DEFAULT_POLICY);
  const ordinary = unscoped.index.key(A);
  unscoped.setPolicy({
    ...POLICY,
    runtimeFiles: [{ project: A.project, tests: [A.path], paths: [absent, RUNTIME] }],
  });
  await unscoped.trackUntracked();
  const scoped = unscoped.index.key(A);
  expect(scoped).not.toBe(ordinary);
  expect(unscoped.index.keysReadAsOne(scoped ?? "")?.keys).toEqual([]);
  unscoped.setPolicy({
    ...POLICY,
    runtimeFiles: [
      { project: A.project, tests: [A.path], paths: [RUNTIME, absent] },
      { project: A.project, tests: [A.path], paths: [RUNTIME] },
    ],
  });
  await unscoped.trackUntracked();
  expect(unscoped.index.key(A)).toBe(scoped);
  unscoped.setPolicy(DEFAULT_POLICY);
  await unscoped.trackUntracked();
  expect(unscoped.index.key(A)).toBe(ordinary);
});
it("protects declared, runner, test, environment, startup, policy and directory inputs", async () => {
  const keys = await keyed();
  const targets = [
    A.path,
    RUNTIME,
    "missing.ts",
    "test/__snapshots__/a.snap",
    "env.json",
    "squeal.config.json",
    ".runtime",
    "declared/absent.json",
    "startup.mjs",
  ];
  keys.setClosure({ testFile: A, paths: [A.path, "missing.ts", "test/__snapshots__/a.snap"] });
  keys.seeStartup(A.project, ["startup.mjs"]);
  await keys.setEnvironments([
    {
      project: A.project,
      runnerName: "fixture",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig: "{}",
      files: ["env.json"],
    },
  ]);
  keys.setPolicy({
    ...POLICY,
    inputs: { [A.path]: ["declared/**"] },
    runtimeFiles: [{ project: A.project, tests: [A.path], paths: targets }],
  });
  await keys.trackUntracked();
  const applied = keys.runtimeApplication(A);
  expect(applied.paths).toEqual([RUNTIME]);
  expect(applied.conflicts.map((c) => c.path).sort()).toEqual(
    targets.filter((p) => p !== RUNTIME).sort(),
  );
});
it("protects dynamic module evidence without changing direct-import scheduling", async () => {
  const keys = await keyed();
  const before = keys.index.key(A);
  keys.markModules(A, [RUNTIME]);
  keys.addObserved(A, [RUNTIME]);
  await keys.trackUntracked();
  expect(keys.runtimeApplication(A)).toMatchObject({
    paths: [],
    conflicts: [{ path: RUNTIME, reason: "observed module load" }],
  });
  expect(keys.index.key(A)).not.toBe(before);
  expect(keys.directOf(A)).toEqual([]);
});
it("shares raw observations between policy views without sharing their effective inputs", async () => {
  const scoped = await keyed();
  const other = await keyed(DEFAULT_POLICY, "other");
  scoped.writeSeen();
  other.refreshObserved([A.project]);
  other.addObserved(A, ["data/new.json"]);
  expect(() =>
    store.transaction(() => {
      other.writeSeen();
      throw new Error("rollback");
    }),
  ).toThrow();
  scoped.writeSeen();
  other.writeSeen();
  scoped.regrowObserved();
  await scoped.trackUntracked();
  other.regrowObserved();
  await other.trackUntracked();
  expect(scoped.observedOf(A)).toEqual(other.observedOf(A));
  expect(scoped.index.closure(A)?.paths).not.toContain(RUNTIME);
  expect(other.index.closure(A)?.paths).toContain(RUNTIME);
  expect(scoped.index.key(A)).not.toBe(other.index.key(A));
});
it("keeps parent listing inputs when the descriptor name changes", async () => {
  const keys = await keyed();
  keys.addObserved(A, [".runtime/"]);
  const before = keys.index.key(A);
  rmSync(join(root, RUNTIME));
  keys.rekeyListings([]);
  expect(keys.index.key(A)).not.toBe(before);
});
