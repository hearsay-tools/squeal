import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type KeyAt, keysAtCommit, sideKeys } from "../../src/core/commit/at-keys.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
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
 * Row 023-16, done-when: with the real Vitest adapter, the key at an older
 * commit is the key a fresh walk there gives, for every case on which the
 * git-only keys of row 023-03 failed review (`reviews/wave-1.md` B1,
 * `wave-1-rereview.md` B1, `wave-3.md` B1 and B2), through `keysAtCommit`
 * and `sideKeys`. Each case's file differs between the commits, so it is
 * walked in a checkout; an unchanged file takes the fast path with no
 * checkout.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");

const PLAIN_FILES = {
  "src/plain.ts": "export const plain = 1;\n",
  [PLAIN.path]: [
    'import { expect, it } from "vitest";',
    'import { plain } from "../src/plain";',
    'it("plain", () => expect(plain).toBe(1));',
    "",
  ].join("\n"),
};

/** A test that imports `../src/<module>` and checks `value`. */
const testOf = (module: string, value: number) =>
  [
    'import { expect, it } from "vitest";',
    `import { value } from "../src/${module}";`,
    `it("value", () => expect(value).toBe(${value}));`,
    "",
  ].join("\n");

/** The key `at` gives, which must be the walk's. */
function walkedKey(at: KeyAt | undefined): string {
  expect(at).toMatchObject({ via: "walk" });
  return at !== undefined && "key" in at ? at.key : "";
}

/**
 * From a worktree at `b`, the key at `a` of `file` through both entries
 * is the fresh walk's at `a`, and not `b`'s; the test file is equal at `a`
 * and `b`, so `sideKeys` with `a`'s code and `b`'s test names `a`'s content.
 */
async function exactAtA(
  f: Fixture,
  [a, b]: readonly [string, string],
  file: TestFileRef,
  reason: RegExp,
): Promise<void> {
  const [atA, atB] = [await freshKey(f, a, file), await freshKey(f, b, file)];
  expect(atA).not.toBe(atB);
  const install = linkInstall();
  const options = { ...keying(f, install.install), root: f.root };
  const keys = await keysAtCommit({ ...options, commit: a, files: [file] });
  expect(keys.current.get(testFileId(file))).toBe(atB);
  expect(walkedKey(keys.files.get(testFileId(file)))).toBe(atA);
  // The fast-path condition that sends the file to the walk.
  expect(keys.changed.get(testFileId(file))).toMatch(reason);
  const side = await sideKeys({ ...options, code: a, tests: b, files: [file] });
  expect(walkedKey(side.get(testFileId(file)))).toBe(atA);
  const own = await sideKeys({ ...options, code: b, tests: null, files: [file] });
  expect(walkedKey(own.get(testFileId(file)))).toBe(atB);
  expect(install.calls()).toBe(3);
  expect(f.checkouts()).toEqual([]);
  const worktrees = git(f.root, "worktree", "list", "--porcelain").match(/^worktree /gm);
  expect(worktrees).toHaveLength(1);
}

describe("keys at a commit by walk in a checkout (row 023-16)", SLOW, () => {
  it("a shrinking closure: A's test read src/old.ts, B's does not (wave-1 B1)", async () => {
    const f = fixture({
      "src/old.ts": "export const n = 2;\n",
      "src/a.ts": 'import { n } from "./old";\nexport const value = n;\n',
      [TEST.path]: testOf("a", 2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({ "src/a.ts": "export const value = 2;\n" });
    await exactAtA(f, [a, b], TEST, /^src\/a\.ts differs at the commit$/);
  });

  it("a glob's removed match: B only removes src/plugins/old.ts (wave-1 re-review B1)", async () => {
    const f = fixture({
      "src/plugins/kept.ts": 'export const name = "kept";\n',
      "src/plugins/old.ts": 'export const name = "old";\n',
      "src/registry.ts":
        'const plugins = import.meta.glob("./plugins/*.ts", { eager: true });\nexport const value = Object.keys(plugins).length;\n',
      [TEST.path]: testOf("registry", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({ "src/plugins/old.ts": null });
    await exactAtA(f, [a, b], TEST, /^src\/plugins\/ lists other names at the commit$/);
  });

  it("a larger current closure: B's registry imports src/old.ts, present at both (wave-3 B1)", async () => {
    const f = fixture({
      "src/old.ts": "export const n = 2;\n",
      "src/registry.ts": "export const value = 1;\n",
      [TEST.path]: testOf("registry", 2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({
      "src/registry.ts": 'import { n } from "./old";\nexport const value = n;\n',
    });
    await exactAtA(f, [a, b], TEST, /^src\/registry\.ts differs at the commit$/);
  });

  it("a package.json imports retarget: only the manifest changes (wave-3 B2)", async () => {
    const manifest = (target: string) =>
      `${JSON.stringify({ name: "fixture", type: "module", imports: { "#chosen": target } })}\n`;
    const f = fixture({
      "package.json": manifest("./src/old.ts"),
      "src/old.ts": "export const n = 1;\n",
      "src/new.ts": "export const n = 2;\n",
      "src/registry.ts": 'import { n } from "#chosen";\nexport const value = n;\n',
      [TEST.path]: testOf("registry", 2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({ "package.json": manifest("./src/new.ts") });
    await exactAtA(f, [a, b], TEST, /^package\.json changed on the resolution path/);
  });

  it("an unchanged file takes the fast path with no checkout; a changed one is walked", async () => {
    const f = fixture({
      ...PLAIN_FILES,
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 3;\n", [TEST.path]: testOf("a", 3) });
    const plainAtA = await freshKey(f, a, PLAIN);
    const install = linkInstall();
    const options = { ...keying(f, install.install), root: f.root, commit: a };

    const fast = await keysAtCommit({ ...options, files: [PLAIN] });
    expect(fast.files.get(testFileId(PLAIN))).toMatchObject({ key: plainAtA, via: "unchanged" });
    expect(fast.checkout).toBe(false);
    expect(install.calls()).toBe(0);

    const both = await keysAtCommit({ ...options, files: [PLAIN, TEST] });
    expect(both.files.get(testFileId(PLAIN))).toMatchObject({ key: plainAtA, via: "unchanged" });
    expect(walkedKey(both.files.get(testFileId(TEST)))).toBe(await freshKey(f, a, TEST));
    expect(both.changed.get(testFileId(TEST))).toMatch(/differs at the commit/);
    expect(install.calls()).toBe(1);
    expect(f.checkouts()).toEqual([]);
  });

  it("compares a dirty tree by its files now, not by HEAD", async () => {
    const f = fixture({
      ...PLAIN_FILES,
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 3;\n" });
    // Back to A's bytes, uncommitted: A's key holds with no checkout.
    writeFileSync(join(f.root, "src/a.ts"), "export const value = 1;\n");
    // PLAIN's source edited, uncommitted: it differs from A now.
    writeFileSync(join(f.root, "src/plain.ts"), "export const plain = 2;\n");
    const install = linkInstall();
    const options = { ...keying(f, install.install), root: f.root, commit: a };
    const keys = await keysAtCommit({ ...options, files: [TEST, PLAIN] });
    expect(keys.files.get(testFileId(TEST))).toMatchObject({
      key: await freshKey(f, a, TEST),
      via: "unchanged",
    });
    expect(walkedKey(keys.files.get(testFileId(PLAIN)))).toBe(await freshKey(f, a, PLAIN));
    expect(install.calls()).toBe(1);
  });

  it("names a test file the commit lacks absent, with no checkout", async () => {
    const f = fixture(PLAIN_FILES);
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: testOf("plain", 1), "src/a.ts": "export const value = 1;\n" });
    const install = linkInstall();
    const keys = await keysAtCommit({ ...keying(f, install.install), root: f.root, commit: a });
    expect(keys.files.get(testFileId(TEST))).toMatchObject({ notDetermined: { reason: "absent" } });
    expect(keys.files.get(testFileId(PLAIN))).toMatchObject({ via: "unchanged" });
    expect(install.calls()).toBe(0);
  });

  it("reads the store's results at the key at the commit, and writes nothing", async () => {
    const f = fixture({
      ...PLAIN_FILES,
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n" });
    const [failAtA, passNow, plainKey] = [
      await freshKey(f, a, TEST),
      await freshKey(f, "HEAD", TEST),
      await freshKey(f, a, PLAIN),
    ];
    const check = (path: string) => ({ kind: "file", project: "", testPath: path }) as const;
    const commonDir = join(f.root, ".git");
    const store = openStore(commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    store.results.putMany([
      result(check(TEST.path), failAtA, { outcome: "fail" }),
      result(check(TEST.path), passNow),
      result(check(PLAIN.path), plainKey),
    ]);
    store.close();
    const database = storePaths(commonDir).database;
    const bytes = () => createHash("sha256").update(readFileSync(database)).digest("hex");
    const before = bytes();

    const options = { ...keying(f), root: f.root, commit: a, files: [TEST, PLAIN] };
    const keys = await keysAtCommit(options);
    expect(keys.store).toBe(true);
    const atA = keys.files.get(testFileId(TEST));
    expect(atA).toMatchObject({ key: failAtA, via: "walk" });
    expect(atA !== undefined && "stored" in atA ? atA.stored.map((r) => r.outcome) : []).toEqual([
      "fail",
    ]);
    const plain = keys.files.get(testFileId(PLAIN));
    expect(plain).toMatchObject({ key: plainKey, via: "unchanged" });
    expect(plain !== undefined && "stored" in plain ? plain.stored : []).toHaveLength(1);
    expect(bytes()).toBe(before);
  });
});
