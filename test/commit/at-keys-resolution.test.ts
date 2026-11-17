import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keysAtCommit } from "../../src/core/commit/at-keys.js";
import { sideKeys } from "../../src/core/commit/at-keys-side.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import {
  BASE,
  type Fixture,
  fixture,
  freshKey,
  git,
  keying,
  linkInstall,
  passesAt,
  ref,
} from "./at-keys-fixture.js";

/*
 * Reviews of wave 5 (row 023-16), with the real Vitest adapter: cases where
 * the key at a commit differs from the current one though the files the
 * current key reads are equal, which defeated the dropped fast path. The
 * keyer in the checkout gives the exact key. The store holds a failure at
 * A's fresh-walk key and a pass at B's; the answer for A must be A's
 * failure, through `keysAtCommit` and `sideKeys`, and the store must not
 * change.
 */

const TEST = ref("test/a.test.ts");

const testOf = (value: number) =>
  [
    'import { expect, it } from "vitest";',
    'import { n } from "../src/a";',
    `it("n", () => expect(n).toBe(${value}));`,
    "",
  ].join("\n");

/** Seeds a failure at A's key and a pass at B's; asks for A from B through both entries. */
async function failAtA(f: Fixture, a: string, file: TestFileRef = TEST): Promise<void> {
  const [atA, atB] = [await freshKey(f, a, file), await freshKey(f, "HEAD", file)];
  expect(atA).not.toBe(atB);
  const commonDir = join(f.root, ".git");
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  const check = { kind: "file", project: "", testPath: file.path } as const;
  store.results.putMany([result(check, atA, { outcome: "fail" }), result(check, atB)]);
  store.close();
  const database = storePaths(commonDir).database;
  const bytes = () => createHash("sha256").update(readFileSync(database)).digest("hex");
  const before = bytes();

  const options = { ...keying(f, linkInstall().install), root: f.root };
  const keys = await keysAtCommit({ ...options, commit: a, files: [file] });
  const at = keys.files.get(testFileId(file));
  expect(at).toMatchObject({ key: atA });
  expect(at !== undefined && "stored" in at ? at.stored.map((r) => r.outcome) : []).toEqual([
    "fail",
  ]);
  const side = await sideKeys({ ...options, code: a, tests: "HEAD", files: [file] });
  expect(side.get(testFileId(file))).toMatchObject({ key: atA });
  expect(bytes()).toBe(before);
  expect(f.checkouts()).toEqual([]);
}

describe("keys at a commit where resolution or the config moves (review wave-5)", SLOW, () => {
  it("B1: a deleted file beside a folder index gives A's key", async () => {
    const f = fixture({
      "src/a.ts": "export const n = 1;\n",
      "src/a/index.ts": "export const n = 2;\n",
      [TEST.path]: testOf(2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": null });
    await failAtA(f, a);
  });

  it("B1, the other way: an added folder index beside a file input gives the fresh key", async () => {
    const f = fixture({ "src/a.ts": "export const n = 1;\n", [TEST.path]: testOf(1) });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a/index.ts": "export const n = 2;\n" });
    const keys = await keysAtCommit({ ...keying(f), root: f.root, commit: a, files: [TEST] });
    expect(keys.files.get(testFileId(TEST))).toMatchObject({
      key: await freshKey(f, a, TEST),
    });
  });

  it("B2: a config that reads a file no key input lists gives A's key", async () => {
    const config = [
      'import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";',
      "export default {",
      '  define: { CHOICE: readFileSync(new URL("./choice.txt", import.meta.url), "utf8").trim() },',
      '  test: { include: ["test/*.test.ts"] },',
      "};",
      "",
    ].join("\n");
    const f = fixture({
      "vitest.config.mjs": config,
      "choice.txt": "1\n",
      "src/a.ts": "declare const CHOICE: string;\nexport const n = Number(CHOICE);\n",
      [TEST.path]: testOf(2),
    });
    expect(BASE["vitest.config.mjs"]).not.toBe(config);
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "choice.txt": "2\n" });
    await failAtA(f, a);
  });

  it("re-review B1: a configured extension's sibling of a folder index, deleted since, gives A's key", async () => {
    const f = fixture({
      "vitest.config.mjs":
        'export default {\n  resolve: { extensions: [".custom", ".ts", ".js", ".json"] },\n  test: { include: ["test/*.test.ts"] },\n};\n',
      "src/a.custom": "export const n = 1;\n",
      "src/a/index.custom": "export const n = 2;\n",
      [TEST.path]: testOf(2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({ "src/a.custom": null });
    // The real runs: A loads the sibling and fails, B loads the folder index and passes.
    expect(passesAt(f, a, TEST)).toBe(false);
    expect(passesAt(f, b, TEST)).toBe(true);
    await failAtA(f, a);
  });

  it("a declared input deleted since gives A's key", async () => {
    const f = fixture({
      "squeal.config.json": `${JSON.stringify({ coverage: { enabled: false }, inputs: ["data/*.txt"] })}\n`,
      "data/a.txt": "a\n",
      "data/b.txt": "b\n",
      "src/a.ts": "export const n = 2;\n",
      [TEST.path]: testOf(2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "data/b.txt": null });
    const keys = await keysAtCommit({ ...keying(f), root: f.root, commit: a, files: [TEST] });
    expect(keys.files.get(testFileId(TEST))).toMatchObject({
      key: await freshKey(f, a, TEST),
    });
  });

  it("third review, case A: a folder manifest's main entry, deeper, once the sibling file is deleted", async () => {
    const file = ref("test/deep/a.test.ts");
    const f = fixture({
      "vitest.config.mjs":
        'export default {\n  resolve: { extensions: [".custom", ".ts", ".js", ".json"] },\n  test: { include: ["test/**/*.test.ts"] },\n};\n',
      "src/a.custom": "export const n = 1;\n",
      "src/a/package.json": `${JSON.stringify({ main: "./lib/deep/entry.custom" })}\n`,
      "src/a/lib/deep/entry.custom": "export const n = 2;\n",
      [file.path]: testOf(2).replace("../src/a", "../../src/a"),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({ "src/a.custom": null });
    expect(passesAt(f, a, file)).toBe(false);
    expect(passesAt(f, b, file)).toBe(true);
    await failAtA(f, a, file);
  });

  it("third review, case B: a tracked folder symlink retargeted", async () => {
    const file = ref("test/deep/a.test.ts");
    const f = fixture({
      "vitest.config.mjs": 'export default { test: { include: ["test/**/*.test.ts"] } };\n',
      "impl/one/index.ts": "export const n = 1;\n",
      "impl/two/index.ts": "export const n = 2;\n",
      [file.path]: testOf(2).replace("../src/a", "../../src/chosen"),
    });
    mkdirSync(join(f.root, "src"));
    symlinkSync("../impl/one", join(f.root, "src/chosen"));
    git(f.root, "add", "-A");
    git(f.root, "commit", "-qm", "A");
    const a = git(f.root, "rev-parse", "HEAD").trim();
    rmSync(join(f.root, "src/chosen"));
    symlinkSync("../impl/two", join(f.root, "src/chosen"));
    git(f.root, "add", "-A");
    git(f.root, "commit", "-qm", "B");
    const b = git(f.root, "rev-parse", "HEAD").trim();
    expect(passesAt(f, a, file)).toBe(false);
    expect(passesAt(f, b, file)).toBe(true);
    await failAtA(f, a, file);
  });
});
