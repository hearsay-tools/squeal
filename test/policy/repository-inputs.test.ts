import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { splitNul, toAbsolute } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { isStoreOpenFailure, openStore, worktreeIdFor } from "../../src/core/store/index.js";
import type { CheckKey, Revision, Store } from "../../src/core/types/index.js";
import { candidatesFromHints } from "../../src/core/watcher/candidates.js";
import { Exclusions } from "../../src/core/watcher/exclusions.js";
import { gitStatus } from "../../src/core/watcher/git.js";
import { buildWatchSpec } from "../../src/core/watcher/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { git } from "../hash/git-repo.js";

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

const PLUGIN_TESTS = (tests: readonly string[]) =>
  tests.filter(
    (path) => path === "test/harness/plugin.test.ts" || /^test\/e2e\/[^/]+\.test\.ts$/.test(path),
  );

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
  testFiles = listed.filter((path) => path.endsWith(".test.ts"));
  for (const path of testFiles) keys.setClosure({ testFile: { project: "", path }, paths: [] });
  await keys.trackUntracked();
}, 60_000);

afterAll(() => {
  store?.close();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

describe("policy: this repository's squeal.config.json", () => {
  it("loads with no problems, and every entry selects a test file and a file", () => {
    expect(loadPolicy(REPO_ROOT).problems).toEqual([]);
    expect(keys.unmatchedInputs(testFiles)).toEqual({ testGlobs: [], inputGlobs: [] });
  });

  it("re-keys exactly plugin.test.ts and the e2e tests when a bundle changes", async () => {
    const plugin = PLUGIN_TESTS(testFiles);
    expect(plugin).toContain("test/harness/plugin.test.ts");
    expect(plugin).toContain("test/e2e/shipped-plugin.test.ts");
    const before = allKeys();

    write("plugins/claude-code/dist/stop.mjs", "// rebuilt\n");
    const revision = await batch("plugins/claude-code/dist/stop.mjs");
    expect(revision?.changes.map((c) => c.path)).toEqual(["plugins/claude-code/dist/stop.mjs"]);
    const rekeyed = keys.index.rekey(revision?.changes.map((c) => c.path) ?? []);

    expect(rekeyed.map((c) => c.testFile.path).sort()).toEqual(plugin);
    const after = allKeys();
    expect(testFiles.filter((path) => after[path] !== before[path])).toEqual(plugin);
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
