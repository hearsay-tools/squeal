import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import {
  blobHash,
  createFsHasher,
  type Hasher,
  StatCache,
  seedStatCache,
} from "../../src/core/hash/index.js";
import { reconcile, statCandidates } from "../../src/core/revision/index.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type RelativePath,
  type RunnerEnvironment,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";

/*
 * Row 011-36 (013 tasks/013-01/design.md section 4): a gitignored path a
 * predecessor hashed stays in the stat cache, as cezar's `packages/cezar/dist`
 * did once its declaration and the project that imported it were removed.
 * Bootstrap watches each such path as an extra file. Once the environment is
 * read and the closures are set, one that no closure, environment, lockfile
 * or observed read names is dropped from the cache and the store and is no
 * longer watched, with no revision.
 */

const TEST: TestFileRef = { project: "", path: "test/a.test.ts" };
const OTHER: TestFileRef = { project: "pkg", path: "pkg/test/b.test.mjs" };
const IMPORTED = "dist/index.js";
const NOTHING = "dist/index.d.ts";
const OBSERVED = "dist/data.json";
const LOCKFILE = "node_modules/.package-lock.json";
const IGNORED = [IMPORTED, NOTHING, OBSERVED, LOCKFILE];

const ENVIRONMENT: RunnerEnvironment = {
  project: "",
  runnerName: "leftovers",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
};

let root: string;
let store: Store;
let keys: WorktreeKeys;
/** Each list `onExtraFiles` was called with. */
let watched: RelativePath[][];
const head = () => readHead(root);

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A full reconciliation pass, as the change feed's: every tracked and extra path is a candidate. */
async function fullPass() {
  const paths = [...keys.cache.paths(), ...keys.extraFiles()];
  const candidates = await statCandidates(paths, createFsHasher(root, "sha1"));
  return keys.reconcile({ trigger: "interval", paths: candidates }, head);
}

const stored = () => store.fileHashes.list(worktreeIdFor(root)).map((row) => row.path);

function openFixtureStore(): Store {
  const opened = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  return opened;
}

function keysOn(opened: Store): WorktreeKeys {
  return new WorktreeKeys({
    root,
    worktreeId: worktreeIdFor(root),
    store: opened,
    hasher: createFsHasher(root, "sha1"),
    objectFormat: "sha1",
    // Observed reads stay out of closures, so they name a path on their own.
    policy: { ...DEFAULT_POLICY, observe: { runtimeInputs: false } },
    squealVersion: "0.0.0-test",
    env: {},
    onExtraFiles: (paths) => watched.push([...paths]),
  });
}

/** `TEST`'s key once the environment is read and its closure names `src/a.ts`. */
async function keyOfTest(on: WorktreeKeys) {
  await on.setEnvironments([ENVIRONMENT]);
  on.setClosure({ testFile: TEST, paths: [TEST.path, "src/a.ts"] });
  await on.trackUntracked();
  return on.index.key(TEST);
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-011-36-")));
  write(".gitignore", "dist/\nnode_modules/\n");
  write("src/a.ts", "export const a = 1;\n");
  write(TEST.path, "import '../src/a.js';\n");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  write(IMPORTED, "export const build = 1;\n");
  write(NOTHING, "export declare const build: number;\n");
  write(OBSERVED, "{}\n");
  write(LOCKFILE, '{"lockfileVersion":3,"packages":{}}\n');
  store = openFixtureStore();
  // As a predecessor left them: every ignored path hashed, the declaration that named some gone.
  const cache = new StatCache();
  await seedStatCache(cache, root, IGNORED, { objectFormat: "sha1" });
  store.transaction(() => cache.flush(store.fileHashes, worktreeIdFor(root)));
  watched = [];
  keys = keysOn(store);
  expect(await keys.bootstrap(head)).toBeNull();
  expect(keys.extraFiles()).toEqual([...IGNORED].sort());
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("a cached ignored path nothing names (row 011-36)", () => {
  it("is dropped and unwatched after the first environment read and closures, with no revision", async () => {
    await keys.setEnvironments([ENVIRONMENT]);
    keys.setClosure({ testFile: TEST, paths: [TEST.path, "src/a.ts", IMPORTED] });
    keys.addObserved(TEST, [OBSERVED]);
    await keys.trackUntracked();

    const named = [IMPORTED, OBSERVED, LOCKFILE].sort();
    expect(keys.extraFiles()).toEqual(named);
    expect(watched.at(-1)).toEqual(named);
    expect([...keys.cache.paths()]).not.toContain(NOTHING);
    expect(stored()).not.toContain(NOTHING);
    for (const path of named) expect(keys.cache.hashOf(path)).toBeDefined();

    // Rewritten, it makes no revision: nothing hashes it now.
    write(NOTHING, "export declare const build: string;\n");
    expect(await fullPass()).toBeNull();
    // A path a closure still names is watched: an edit is a revision.
    write(IMPORTED, "export const build = 2;\n");
    expect((await fullPass())?.changes.map((change) => change.path)).toEqual([IMPORTED]);
  });

  it("stays watched until the environment is read, which names the lockfile", async () => {
    keys.setClosure({ testFile: TEST, paths: [TEST.path, "src/a.ts"] });
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([...IGNORED].sort());

    await keys.setEnvironments([ENVIRONMENT]);
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([LOCKFILE]);
  });

  it("is dropped once the closure that named it is replaced by one that does not", async () => {
    await keys.setEnvironments([ENVIRONMENT]);
    // A saved closure names the build; the runner's no longer does.
    keys.setClosure({ testFile: TEST, paths: [TEST.path, IMPORTED] });
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([IMPORTED, LOCKFILE]);

    keys.setClosure({ testFile: TEST, paths: [TEST.path, "src/a.ts"] });
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([LOCKFILE]);
    expect(stored()).not.toContain(IMPORTED);
  });

  it("is dropped once the test file whose closure named it is removed, as with a removed project", async () => {
    await keys.setEnvironments([ENVIRONMENT]);
    keys.setClosure({ testFile: OTHER, paths: [OTHER.path, IMPORTED] });
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([IMPORTED, LOCKFILE]);

    keys.removeTestFile(OTHER);
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([LOCKFILE]);
  });

  it("is tracked and watched again when a closure names it after the drop", async () => {
    await keys.setEnvironments([ENVIRONMENT]);
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([LOCKFILE]);

    keys.setClosure({ testFile: TEST, paths: [TEST.path, IMPORTED] });
    expect(keys.index.key(TEST)).toBeNull();
    await keys.trackUntracked();
    expect(keys.extraFiles()).toEqual([IMPORTED, LOCKFILE]);
    expect(keys.cache.hashOf(IMPORTED)).toBeDefined();
  });
});

/*
 * Review 0.1.310 B1 (row 011-204): a pass reads src/a.ts, and the file is
 * appended to after the read, before the pass stats it again. No watcher
 * batch follows; the daemon restarts. By the end of its bootstrap the append
 * is a revision: the pass's own, when it reads the file again (011-204 round
 * 3), or the bootstrap's.
 */
describe("a write after a pass's read, then a restart (review 0.1.310 B1)", () => {
  it("is a revision by the next bootstrap, with no batch, and the test's key moves", async () => {
    const before = await keyOfTest(keys);
    expect(before).not.toBeNull();
    const read = readFileSync(join(root, "src/a.ts"), "utf8");

    // A later mtime makes the pass read the file, whatever its racy mark.
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(root, "src/a.ts"), later, later);
    const fs = createFsHasher(root, "sha1");
    let appended = false;
    const appending: Hasher = {
      ...fs,
      hash: async (path) => {
        const hash = await fs.hash(path);
        if (!appended) appendFileSync(join(root, path), "// post-read write\n");
        appended = true;
        return hash;
      },
    };
    const paths = await statCandidates(["src/a.ts" as RelativePath], fs);
    const pass = await reconcile({ trigger: "watch", paths }, keys.cache, appending, {
      worktreeId: worktreeIdFor(root),
      store,
      head,
    });

    store.close();
    store = openFixtureStore();
    const restarted = keysOn(store);
    const revision = await restarted.bootstrap(head);

    const disk = readFileSync(join(root, "src/a.ts"));
    expect([pass, revision].flatMap((r) => r?.changes ?? [])).toEqual([
      {
        path: "src/a.ts",
        oldHash: blobHash(Buffer.from(read), "sha1"),
        newHash: blobHash(disk, "sha1"),
      },
    ]);
    const after = await keyOfTest(restarted);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
});
