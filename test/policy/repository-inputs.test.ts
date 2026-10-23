import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { splitNul, toAbsolute, worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { createInputMatcher } from "../../src/core/keys/glob.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { CheckKey, Revision, Store } from "../../src/core/types/index.js";
import { candidatesFromHints } from "../../src/core/watcher/candidates.js";
import { Exclusions } from "../../src/core/watcher/exclusions.js";
import { gitStatus } from "../../src/core/watcher/git.js";
import { buildWatchSpec } from "../../src/core/watcher/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { git } from "../hash/git-repo.js";
import { observeBuildInputs } from "../helpers/build-inputs.js";

/*
 * Review wave 7, input 4: `test/harness/plugin.test.ts` reads the committed
 * bundles at runtime, so its key matched across a rebuild and Squeal kept its
 * FAIL. The committed `squeal.config.json` declares those reads (D3, D11).
 * This holds the committed file against this repository's own paths: a
 * mirror of every path git lists (stub contents; `.gitignore` files and the
 * policy copied as they are) keyed through `loadPolicy` and `WorktreeKeys`
 * over a real store. Runner closures are empty: only declared inputs are
 * under test, and no test file imports the bundles statically. This file
 * reads the policy and the `.gitignore` files, so it declares them too.
 */

const E2E = /^test\/e2e\/[^/]+\.test\.ts$/;
const TSC = join(REPO_ROOT, "node_modules/typescript/bin/tsc");

let root: string;
let store: Store;
let keys: WorktreeKeys;
let testFiles: string[];
const hasher = () => createFsHasher(root, "sha1");
const head = () => readHead(root);
const keyOf = (path: string): CheckKey | null => keys.index.key({ project: "", path });
const allKeys = () => Object.fromEntries(testFiles.map((path) => [path, keyOf(path)]));

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A watch batch for `paths`, as the change feed hands it over after the debounce. */
async function batch(...paths: string[]): Promise<Revision | null> {
  return keys.reconcile({ trigger: "watch", paths: await statCandidates(paths, hasher()) }, head);
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sq-inputs-")));
  const listed = splitNul(
    execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }),
  );
  for (const path of listed) {
    const verbatim = basename(path) === ".gitignore" || path === POLICY_FILE;
    write(path, verbatim ? readFileSync(join(REPO_ROOT, path), "utf8") : `${path}\n`);
  }
  git(root, ["init", "-q", "-b", "main"]);
  // A mirror of ~2,800 files leaves enough loose objects for `git commit` to start a
  // detached `gc --auto`, still writing `.git` when afterAll removes it (ENOTEMPTY on CI).
  git(root, ["config", "gc.auto", "0"]);
  git(root, ["config", "maintenance.auto", "false"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "mirror"]);

  const opened = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  store = opened;
  const { policy, problems } = loadPolicy(root);
  expect(problems).toEqual([]);
  keys = new WorktreeKeys({
    root,
    worktreeId: worktreeIdFor(root),
    store,
    hasher: hasher(),
    objectFormat: "sha1",
    policy,
    squealVersion: "0.0.0-test",
    onExtraFiles: () => {},
  });
  await keys.bootstrap(head);
  keys.index.setEnvironment("", "environment");
  // The Vitest adapter lists no file `vitest.exclude` selects (004 D7, task 004-81).
  const excluded = createInputMatcher(policy.vitest.exclude);
  testFiles = listed.filter((path) => path.endsWith(".test.ts") && !excluded(path));
  for (const path of testFiles) keys.setClosure({ testFile: { project: "", path }, paths: [] });
  await keys.trackUntracked();
}, 60_000);

afterAll(() => {
  store?.close();
  // `git` children of the run can still be writing under `.git` (CI, Node 22): retry the removal.
  if (root !== undefined)
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("policy: this repository's squeal.config.json", () => {
  it("loads with no problems, and every entry selects a test file and a file", () => {
    expect(loadPolicy(REPO_ROOT).problems).toEqual([]);
    expect(keys.unmatchedInputs(testFiles)).toEqual({ testGlobs: [], inputGlobs: [] });
  });

  /*
   * Task 004-81 (004 D7 as amended 2026-10-18): the e2e tests run the
   * committed bundles, a build output Squeal does not produce, so Squeal
   * covers none of them; CI runs them. Row 011-141: the tests that build the
   * CLI or a bundle from the sources while they run, and key on all of it, are
   * the slow files; each glob selects one, and none an in-process daemon test.
   */
  it("excludes the e2e tests, lists every other test file, and runs the build tests slow", () => {
    const { policy } = loadPolicy(REPO_ROOT);
    expect(policy.vitest.exclude).toEqual(["test/e2e/**"]);
    expect(testFiles.filter((path) => E2E.test(path))).toEqual([]);
    expect(testFiles).toContain("test/harness/plugin.test.ts");
    for (const glob of policy.slow.include) {
      expect(testFiles.filter(createInputMatcher([glob])), glob).not.toEqual([]);
    }
    // `slowFiles` (004 D1) for a Vitest file: this repository has no node:test project.
    const slow = testFiles.filter(createInputMatcher(policy.slow.include));
    expect(slow).toHaveLength(60);
    expect(slow).toContain("test/daemon/busy-tier.test.ts");
    expect(slow).not.toContain("test/daemon/drain-timers.test.ts");
  });

  it("re-keys exactly plugin.test.ts when a bundle changes", async () => {
    const plugin = ["test/harness/plugin.test.ts"];
    const before = allKeys();

    write("plugins/claude-code/dist/stop.mjs", "// rebuilt\n");
    const revision = await batch("plugins/claude-code/dist/stop.mjs");
    expect(revision?.changes.map((c) => c.path)).toEqual(["plugins/claude-code/dist/stop.mjs"]);
    const rekeyed = keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);

    expect(rekeyed.map((c) => c.testFile.path).sort()).toEqual(plugin);
    const after = allKeys();
    expect(testFiles.filter((path) => after[path] !== before[path])).toEqual(plugin);
  });

  /*
   * Task 001-399: the OpenCode and Pi tests build their bundles from
   * `src/harness/*` in an esbuild child process and read the committed
   * package, neither of which tracing follows.
   */
  it.each([
    ["opencode", "plugins/opencode/dist/plugin.mjs"],
    ["pi", "plugins/pi/dist/extension.mjs"],
  ])("re-keys exactly the %s harness tests when its package changes", async (harness, bundle) => {
    const harnessTests = testFiles.filter((path) => path.startsWith(`test/harness/${harness}/`));
    const tests = harnessTests;
    expect(harnessTests).toContain(`test/harness/${harness}/package.test.ts`);
    const before = allKeys();

    write(bundle, "// rebuilt\n");
    const revision = await batch(bundle);
    keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);

    const after = allKeys();
    expect(testFiles.filter((path) => after[path] !== before[path])).toEqual(tests);
  });

  it("re-keys the OpenCode and Pi package tests when a source they bundle changes", async () => {
    const before = allKeys();
    write("src/harness/opencode/bridge-turn.ts", "// edited, not rebuilt\n");
    const revision = await batch("src/harness/opencode/bridge-turn.ts");
    keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);

    const after = allKeys();
    const rekeyed = testFiles.filter((path) => after[path] !== before[path]);
    expect(rekeyed).toContain("test/harness/opencode/package.test.ts");
    expect(rekeyed).toContain("test/harness/pi/package.test.ts");
  });

  it("re-keys the adapter tests, and no others, when a vitest fixture changes", async () => {
    const adapter = testFiles.filter((path) => path.startsWith("test/runners/vitest/"));
    expect(adapter.length).toBeGreaterThan(0);
    const fixture = [...keys.cache.paths()].find(
      (path) => path.startsWith("test/fixtures/vitest/") && basename(path) !== ".gitignore",
    );
    if (fixture === undefined) throw new Error("no tracked file under test/fixtures/vitest/");
    const before = allKeys();

    write(fixture, "// edited\n");
    const revision = await batch(fixture);
    keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);

    const after = allKeys();
    expect(testFiles.filter((path) => after[path] !== before[path])).toEqual(adapter);
  });

  /*
   * Row 011-141: `busy-tier.test.ts` builds the CLI with `tsc` and imports
   * none of the scheduler; `buildCli` stats each file `tsc` compiled, so its
   * run observes them (011 C12). With that observed set, a `scheduler.ts` edit
   * re-keys it, and a daemon test that observed no build keeps its key. `tsc`
   * lists the files, which can outlast the 5 s default on a loaded host.
   */
  it("re-keys busy-tier.test.ts on a scheduler.ts edit, by what its build compiled", {
    timeout: 60_000,
  }, async () => {
    const busyTier = "test/daemon/busy-tier.test.ts";
    const listed = execFileSync(
      process.execPath,
      [TSC, "-p", join(REPO_ROOT, "tsconfig.build.json"), "--listFilesOnly"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    // Stat'ed in the mirror, as `buildCli` stats them in the worktree.
    const compiled = observeBuildInputs(
      listed
        .split("\n")
        .filter((path) => path !== "")
        .map((path) => relative(REPO_ROOT, path)),
      root,
    );
    expect(compiled).toContain("src/core/scheduler/scheduler.ts");
    keys.addObserved({ project: "", path: busyTier }, compiled);
    const before = allKeys();

    write("src/core/scheduler/scheduler.ts", "// edited, not rebuilt\n");
    const revision = await batch("src/core/scheduler/scheduler.ts");
    keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);

    const after = allKeys();
    const rekeyed = testFiles.filter((path) => after[path] !== before[path]);
    expect(rekeyed).toContain(busyTier);
    expect(rekeyed).not.toContain("test/daemon/busy-store.test.ts");
  });

  /*
   * The adapter tests copy the fixtures to `test/fixtures/vitest/.tmp/` and
   * run there. Those copies must not re-key them on every run: D2 drops
   * gitignored paths at watch time and at batch time, and the reconciliation
   * pass reads `git status`, which leaves them out too.
   */
  it("makes no revision for a scratch copy under test/fixtures/vitest/.tmp/", async () => {
    const scratch = "test/fixtures/vitest/.tmp/0b5e/basic/src/math.ts";
    const latest = store.revisions.latest(worktreeIdFor(root));
    write(scratch, "export const n = 1;\n");

    const spec = await buildWatchSpec(root);
    expect(spec.excluded).toContain(toAbsolute(root, "test/fixtures/vitest/.tmp"));
    const hints = await candidatesFromHints(
      {
        root,
        exclusions: new Exclusions({ ...spec, excluded: [] }),
        extraFiles: new Set(keys.extraFiles()),
        trackedPaths: () => keys.cache.paths(),
      },
      [toAbsolute(root, scratch), toAbsolute(root, "test/fixtures/vitest/.tmp")],
    );
    expect(hints.paths).toEqual([]);
    expect(await keys.reconcile({ trigger: "watch", paths: hints.paths }, head)).toBeNull();
    expect((await gitStatus(root)).paths).not.toContain(scratch);
    expect(store.revisions.latest(worktreeIdFor(root))).toEqual(latest);
    expect(keys.cache.hashOf(scratch)).toBeUndefined();
  });
});
