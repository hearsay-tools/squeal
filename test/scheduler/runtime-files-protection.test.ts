import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { acceptedAt } from "../../src/core/scheduler/accept.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Policy,
  type RunnerEnvironment,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";

const DATA = ".runtime/descriptor.json";
const A: TestFileRef = { project: "browser", path: "test/a.test.ts" };
const B: TestFileRef = { project: "browser", path: "test/b.test.ts" };
const OUT: TestFileRef = { project: "browser", path: "test/outside.test.ts" };
const environment: RunnerEnvironment = {
  project: A.project,
  runnerName: "fixture",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
};
const policy = (tests = [A.path], paths = [DATA]): Policy => ({
  ...DEFAULT_POLICY,
  runtimeFiles: [{ project: A.project, tests, paths }],
});
let root: string;
let store: Store;
function write(path: string, text = "one\n") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-runtime-protection-")));
  for (const ref of [A, B, OUT]) write(ref.path, "// test\n");
  write(".gitignore", ".runtime/\nnode_modules/\n");
  write("package.json", '{"name":"fixture","version":"1"}\n');
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  write(DATA);
  const opened = openStore(join(root, ".git"));
  if (isStoreOpenFailure(opened)) throw new Error(JSON.stringify(opened));
  store = opened;
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});
async function keyed(
  selected = policy(),
  environments = [environment],
  onExtraFiles: (paths: readonly string[]) => void = () => {},
) {
  const keys = new WorktreeKeys({
    root,
    worktreeId: "here",
    store,
    hasher: createFsHasher(root, "sha1"),
    objectFormat: "sha1",
    policy: selected,
    squealVersion: "0.0.0-test",
    env: {},
    onExtraFiles,
  });
  await keys.bootstrap(() => readHead(root));
  await keys.setEnvironments(environments);
  for (const ref of [A, B, OUT]) keys.setClosure({ testFile: ref, paths: [ref.path] });
  await keys.trackUntracked();
  return keys;
}
async function changed(keys: WorktreeKeys, path: string) {
  const revision = await keys.reconcile(
    { trigger: "watch", paths: await statCandidates([path], createFsHasher(root, "sha1")) },
    () => readHead(root),
  );
  keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);
  return revision;
}

it("retains real ignored build data beside an exact runtime file", async () => {
  const build = ".runtime/build.json";
  write(build);
  const keys = await keyed(policy([A.path, B.path]));
  keys.addObserved(A, [DATA, build]);
  keys.addObserved(B, [DATA]);
  await keys.trackUntracked();
  const before = [keys.index.key(A), keys.index.key(B)];
  write(build, "two\n");
  await changed(keys, build);
  expect(keys.index.key(A)).not.toBe(before[0]);
  expect(keys.index.key(B)).toBe(before[1]);
  expect(keys.extraFiles()).toContain(build);
  expect(keys.extraFiles()).not.toContain(DATA);
});

it("protects an environment only for its project while retaining the shared watch", async () => {
  const server = { ...A, project: "server" };
  const environments = [environment, { ...environment, project: server.project, files: [DATA] }];
  const keys = await keyed(
    {
      ...policy(),
      runtimeFiles: [
        ...policy().runtimeFiles,
        { project: server.project, tests: [A.path], paths: [DATA] },
      ],
    },
    environments,
  );
  keys.setClosure({ testFile: server, paths: [server.path] });
  for (const ref of [A, server]) keys.addObserved(ref, [DATA]);
  await keys.trackUntracked();
  expect(keys.runtimeApplication(A).paths).toEqual([DATA]);
  expect(keys.runtimeApplication(server).conflicts).toEqual([
    { path: DATA, reason: "project environment or startup module" },
  ]);
  const before = [keys.index.key(A), keys.index.key(server)];
  write(DATA, "two\n");
  await changed(keys, DATA);
  await keys.setEnvironments(environments);
  expect(keys.index.key(A)).toBe(before[0]);
  expect(keys.index.key(server)).not.toBe(before[1]);
  expect(keys.extraFiles()).toContain(DATA);
});

it("retains installed patches and package manifests and rekeys on patch changes", async () => {
  const patch = "patches/a.patch";
  write(patch);
  write("node_modules/.package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: {} }));
  const keys = await keyed(policy([A.path], [DATA, patch, "package.json"]));
  expect(keys.runtimeApplication(A)).toMatchObject({
    paths: [DATA],
    conflicts: [
      { path: "package.json", reason: "package manifest" },
      { path: patch, reason: "installed dependency" },
    ],
  });
  const before = keys.index.key(A);
  write(patch, "two\n");
  await changed(keys, patch);
  await keys.setEnvironments([environment]);
  expect(keys.index.key(A)).not.toBe(before);
  expect(keys.runtimeApplication(A).paths).toEqual([DATA]);
});

it("keeps ordinary revisions for tracked runtime files without rekeying their scoped reader", async () => {
  git(root, ["add", "-f", DATA]);
  git(root, ["commit", "-qm", "track descriptor"]);
  const keys = await keyed();
  keys.addObserved(A, [DATA]);
  await keys.trackUntracked();
  const before = keys.index.key(A);
  write(DATA, "two\n");
  expect((await changed(keys, DATA))?.changes.map((c) => c.path)).toEqual([DATA]);
  expect(keys.index.key(A)).toBe(before);
  expect(keys.cache.hashOf(DATA)).toBeDefined();
});

it("resolves absent-file rescoping deterministically and leaves unrelated keys equal", async () => {
  const absent = ".runtime/absent.json";
  const keys = await keyed(policy([A.path], [DATA, absent]));
  const before = [keys.index.key(A), keys.index.key(B), keys.index.key(OUT)];
  keys.setPolicy(policy([A.path], [absent, DATA]));
  await keys.trackUntracked();
  expect([keys.index.key(A), keys.index.key(B), keys.index.key(OUT)]).toEqual(before);
  keys.setPolicy(policy([B.path], [DATA, absent]));
  await keys.trackUntracked();
  expect(keys.index.key(A)).not.toBe(before[0]);
  expect(keys.index.key(B)).not.toBe(before[1]);
  expect(keys.index.key(OUT)).toBe(before[2]);
});

it("refuses seeded old current and compatibility passes, and restores their original contract", async () => {
  const keys = await keyed(DEFAULT_POLICY);
  const old = keys.index.key(A);
  if (old === null) throw new Error("fixture is keyed");
  const aliases = keys.index.keysReadAsOne(old)?.keys ?? [];
  expect(aliases.length).toBeGreaterThan(0);
  const check = { kind: "test" as const, project: A.project, testPath: A.path, fullName: "passes" };
  store.results.putMany(
    [old, ...aliases].map((key) => ({
      check,
      key,
      outcome: "pass" as const,
      durationMs: 1,
      location: null,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId: "old",
        revision: 0,
        commit: "0".repeat(40),
        dirty: false,
        runId: "old",
        recordedAt: Date.now(),
      },
    })),
  );
  keys.setPolicy(policy([A.path], [".runtime/absent.json"]));
  await keys.trackUntracked();
  const scoped = keys.index.key(A);
  if (scoped === null) throw new Error("scoped fixture is keyed");
  const listed = {
    keys: (key: string) => keys.index.keysReadAsOne(key),
    read: new Map<string, string>(),
  };
  expect(acceptedAt(store, "here", scoped, Date.now, listed).hits).toEqual([]);
  expect(store.results.byKey(scoped)).toEqual([]);
  keys.setPolicy(DEFAULT_POLICY);
  await keys.trackUntracked();
  expect(keys.index.key(A)).toBe(old);
  expect(acceptedAt(store, "here", old, Date.now, listed).hits).toHaveLength(1);
});

it("does not hash or watch an excluded path left by an intermediate saved closure", async () => {
  const watched: (readonly string[])[] = [];
  const keys = await keyed(policy(), [environment], (paths) => watched.push(paths));
  keys.setClosure({ testFile: A, paths: [A.path, DATA] }, true);
  keys.setClosure({ testFile: A, paths: [A.path] });
  await keys.trackUntracked();
  expect(watched).toEqual([]);
  expect(keys.cache.hashOf(DATA)).toBeUndefined();
});
