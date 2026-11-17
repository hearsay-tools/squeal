import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keysAtCommit } from "../../src/core/commit/at-keys.js";
import type { KeyAt } from "../../src/core/commit/at-keys-checkout.js";
import { committedBlobs } from "../../src/core/commit/tree.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { commitSegments, keyOver, NO_PARTS } from "../../src/core/store/transfer-rekey.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { SLOW } from "../scheduler/cleanup.js";
import { untouched } from "../shared/remote.js";
import { ciExportAt, publishLocal, recordHere, withRemote } from "./at-keys-ci-fixture.js";
import {
  type Fixture,
  fixture,
  freshKey,
  git,
  keying,
  linkInstall,
  ref,
} from "./at-keys-fixture.js";

/*
 * Row 023-17, done-when: with an export ref at the commit, the exported
 * files take CI's key and pass with no checkout for them; a file the
 * export lacks, or whose environment differs, goes to the checkout; the
 * key from the export is the key the checkout gives (exactness); nothing
 * shared is written. Real Vitest adapter, as row 023-16's tests.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");

const FILES = {
  "src/a.ts": "export const value = 1;\n",
  "src/plain.ts": "export const plain = 1;\n",
  [TEST.path]: [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    'it("value", () => expect(value).toBe(1));',
    "",
  ].join("\n"),
  [PLAIN.path]: [
    'import { expect, it } from "vitest";',
    'import { plain } from "../src/plain";',
    'it("plain", () => expect(plain).toBe(1));',
    "",
  ].join("\n"),
};

const SHARED = {
  "squeal.config.json": `${JSON.stringify({ coverage: { enabled: false }, shared: { ref: "refs/squeal" } })}\n`,
};

const keyOf = (at: KeyAt | undefined) => (at !== undefined && "key" in at ? at.key : "");
const storedOf = (at: KeyAt | undefined) => (at !== undefined && "stored" in at ? at.stored : []);

/** Commit `a` with FILES, then `b` changing `src/a.ts`, pushed to a remote; the worktree's environment recorded. */
async function twoCommits(extra: Record<string, string> = {}): Promise<{ f: Fixture; a: string }> {
  const f = fixture({ ...FILES, ...extra });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n" });
  withRemote(f);
  await recordHere(f);
  return { f, a };
}

const database = (f: Fixture) => storePaths(join(f.root, ".git") as AbsolutePath).database;
const bytes = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("keys at a commit from CI's export (row 023-17)", SLOW, () => {
  it("exported files take CI's key and pass with no checkout; the key is the checkout's; nothing is written", async () => {
    const { f, a } = await twoCommits();
    publishLocal(f.root, a, await ciExportAt(f, a, [TEST, PLAIN]));
    const [testAtA, plainAtA] = [await freshKey(f, a, TEST), await freshKey(f, a, PLAIN)];
    const before = { db: bytes(database(f)), git: untouched(f.root) };

    const install = linkInstall();
    const options = {
      ...keying(f, install.install),
      root: f.root,
      commit: a,
      files: [TEST, PLAIN],
    };
    const keys = await keysAtCommit(options);
    expect(install.calls()).toBe(0);
    expect(keys.checkoutMs).toBeNull();
    expect(keys.ci).toEqual({
      source: `CI run 7 on o/r at ${a.slice(0, 8)}`,
      settled: 2,
      missed: null,
    });
    for (const [file, fresh] of [
      [TEST, testAtA],
      [PLAIN, plainAtA],
    ] as const) {
      const at = keys.files.get(testFileId(file));
      expect(keyOf(at)).toBe(fresh);
      expect(storedOf(at).map((r) => [r.outcome, r.origin, r.key])).toEqual([
        ["pass", "ci", fresh],
      ]);
    }
    expect({ db: bytes(database(f)), git: untouched(f.root) }).toEqual(before);

    // Exactness: the checkout, with the CI step off, gives the same keys.
    const off = await keysAtCommit({ ...options, ci: false });
    expect(install.calls()).toBe(1);
    expect(off.ci).toBeUndefined();
    expect(keyOf(off.files.get(testFileId(TEST)))).toBe(testAtA);
    expect(keyOf(off.files.get(testFileId(PLAIN)))).toBe(plainAtA);
  });

  it("a file the export lacks goes to the checkout; with no named files CI's answer stands", async () => {
    const { f, a } = await twoCommits();
    publishLocal(f.root, a, await ciExportAt(f, a, [PLAIN]));
    const testAtA = await freshKey(f, a, TEST);
    const install = linkInstall();
    const options = { ...keying(f, install.install), root: f.root, commit: a };
    const keys = await keysAtCommit({ ...options, files: [TEST, PLAIN] });
    expect(install.calls()).toBe(1);
    expect(keys.ci?.settled).toBe(1);
    expect(keyOf(keys.files.get(testFileId(TEST)))).toBe(testAtA);
    expect(storedOf(keys.files.get(testFileId(TEST)))).toEqual([]);
    expect(storedOf(keys.files.get(testFileId(PLAIN))).map((r) => r.origin)).toEqual(["ci"]);

    const all = await keysAtCommit(options);
    expect(install.calls()).toBe(2);
    expect(storedOf(all.files.get(testFileId(PLAIN))).map((r) => r.origin)).toEqual(["ci"]);
    expect(keyOf(all.files.get(testFileId(TEST)))).toBe(testAtA);
  });

  it("a file whose exported environment differs here goes to the checkout", async () => {
    const { f, a } = await twoCommits();
    const bundle = await ciExportAt(f, a, [TEST]);
    // A self-consistent export from another install: its keys reproduce from its own hash.
    const at = commitSegments(await committedBlobs(f.root, a));
    const [environment] = bundle.environments;
    if (environment?.descriptor == null) throw new Error("no descriptor in the export");
    const hash = "e".repeat(64);
    const rekey = (file: ResultsBundle["testFiles"][number]) =>
      keyOver(hash, file, file.closure?.paths ?? [], at, file.keyParts ?? NO_PARTS);
    const testFiles = bundle.testFiles.map((file) => ({ ...file, key: rekey(file) }));
    const other: ResultsBundle = {
      ...bundle,
      environments: [
        {
          ...environment,
          hash,
          descriptor: { ...environment.descriptor, installedDependencies: "other" },
        },
      ],
      testFiles,
      results: bundle.results.map((r) => ({ ...r, key: testFiles[0]?.key ?? r.key })),
    };
    publishLocal(f.root, a, other);
    const install = linkInstall();
    const keys = await keysAtCommit({
      ...keying(f, install.install),
      root: f.root,
      commit: a,
      files: [TEST],
    });
    expect(install.calls()).toBe(1);
    expect(keys.ci).toMatchObject({ settled: 0, missed: null });
    expect(keyOf(keys.files.get(testFileId(TEST)))).toBe(await freshKey(f, a, TEST));
    expect(storedOf(keys.files.get(testFileId(TEST)))).toEqual([]);
  });

  it("fetches the ref once when shared.ref is set, writing no ref, config or FETCH_HEAD", async () => {
    const { f, a } = await twoCommits(SHARED);
    const results = publishLocal(f.root, a, await ciExportAt(f, a, [TEST]));
    git(f.root, "push", "-q", "origin", `refs/squeal/${a}`);
    git(f.root, "update-ref", "-d", `refs/squeal/${a}`);
    const before = untouched(f.root);
    const install = linkInstall();
    const keys = await keysAtCommit({
      ...keying(f, install.install),
      root: f.root,
      commit: a,
      files: [TEST],
    });
    expect(install.calls()).toBe(0);
    expect(keys.ci?.settled).toBe(1);
    expect(storedOf(keys.files.get(testFileId(TEST))).map((r) => r.origin)).toEqual(["ci"]);
    expect(untouched(f.root)).toBe(before);
    expect(results).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reaches no remote without shared.ref when the clone lacks the ref", async () => {
    const { f, a } = await twoCommits();
    const results = publishLocal(f.root, a, await ciExportAt(f, a, [TEST]));
    git(f.root, "push", "-q", "origin", `refs/squeal/${a}`);
    git(f.root, "update-ref", "-d", `refs/squeal/${a}`);
    // Drops the results commit's objects here, so a fetch would bring them back.
    git(f.root, "reflog", "expire", "--expire=now", "--all");
    git(f.root, "gc", "-q", "--prune=now");
    const held = () => {
      try {
        execFileSync("git", ["cat-file", "-e", results], { cwd: f.root, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    expect(held()).toBe(false);
    const install = linkInstall();
    const keys = await keysAtCommit({
      ...keying(f, install.install),
      root: f.root,
      commit: a,
      files: [TEST],
    });
    expect(keys.ci).toEqual({ source: null, settled: 0, missed: null });
    expect(install.calls()).toBe(1);
    expect(held()).toBe(false);
  });
});
