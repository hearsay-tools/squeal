import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keysAtCommit } from "../../src/core/commit/at-keys.js";
import { sideKeys } from "../../src/core/commit/at-keys-side.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
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
 * Review wave-5 B1 and B2 (row 023-16), with the real Vitest adapter: the
 * fast path's git checks pass, yet the key at the commit differs from the
 * current one. B1: `../src/a` resolves to `src/a.ts` at A and to
 * `src/a/index.ts` once B deletes `src/a.ts`. B2: the config reads
 * `choice.txt`, which no key input lists. The store holds a failure at A's
 * fresh-walk key and a pass at B's; the answer for A must be A's failure,
 * and the store must not change.
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
async function failAtA(f: Fixture, a: string, reason: RegExp): Promise<void> {
  const [atA, atB] = [await freshKey(f, a, TEST), await freshKey(f, "HEAD", TEST)];
  expect(atA).not.toBe(atB);
  const commonDir = join(f.root, ".git");
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  const check = { kind: "file", project: "", testPath: TEST.path } as const;
  store.results.putMany([result(check, atA, { outcome: "fail" }), result(check, atB)]);
  store.close();
  const database = storePaths(commonDir).database;
  const bytes = () => createHash("sha256").update(readFileSync(database)).digest("hex");
  const before = bytes();

  const options = { ...keying(f, linkInstall().install), root: f.root };
  const keys = await keysAtCommit({ ...options, commit: a, files: [TEST] });
  const at = keys.files.get(testFileId(TEST));
  expect(at).toMatchObject({ key: atA, via: "walk" });
  expect(at !== undefined && "stored" in at ? at.stored.map((r) => r.outcome) : []).toEqual([
    "fail",
  ]);
  expect(keys.changed.get(testFileId(TEST))).toMatch(reason);
  const side = await sideKeys({ ...options, code: a, tests: "HEAD", files: [TEST] });
  expect(side.get(testFileId(TEST))).toMatchObject({ key: atA, via: "walk" });
  expect(bytes()).toBe(before);
  expect(f.checkouts()).toEqual([]);
}

describe("keys at a commit where resolution or the config moves (review wave-5)", SLOW, () => {
  it("B1: a deleted file beside a folder index sends the file to the walk", async () => {
    const f = fixture({
      "src/a.ts": "export const n = 1;\n",
      "src/a/index.ts": "export const n = 2;\n",
      [TEST.path]: testOf(2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": null });
    await failAtA(
      f,
      a,
      /^src\/a\.ts was added or deleted in src, where the closure's imports resolve$/,
    );
  });

  it("B1, the other way: an added folder index beside a file input gives the fresh key", async () => {
    const f = fixture({ "src/a.ts": "export const n = 1;\n", [TEST.path]: testOf(1) });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a/index.ts": "export const n = 2;\n" });
    const keys = await keysAtCommit({ ...keying(f), root: f.root, commit: a, files: [TEST] });
    expect(keys.files.get(testFileId(TEST))).toMatchObject({
      key: await freshKey(f, a, TEST),
      via: "walk",
    });
    expect(keys.changed.get(testFileId(TEST))).toMatch(
      /^src\/a\/index\.ts was added or deleted in src, where/,
    );
  });

  it("B2: a config that reads a file no key input lists sends the file to the walk", async () => {
    const config = [
      'import { readFileSync } from "node:fs";',
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
    await failAtA(f, a, /^the environment of project "" differs at the commit$/);
  });

  it("re-review B1: a configured extension's sibling of a folder index, deleted since, sends the file to the walk", async () => {
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
    await failAtA(
      f,
      a,
      /^src\/a\.custom was added or deleted in src, where the closure's imports resolve$/,
    );
  });

  it("a declared input deleted since sends the file to the walk", async () => {
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
      via: "walk",
    });
    expect(keys.changed.get(testFileId(TEST))).toBe(
      "data/b.txt is a declared input at the commit, not here",
    );
  });
});
