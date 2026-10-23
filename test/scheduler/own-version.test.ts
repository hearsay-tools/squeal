import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../hash/git-repo.js";
import { writeInstall } from "../keys/install.js";
import {
  ALL_TEST_FILES,
  createRepo,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";
import { idleAfterQuiet } from "./quiet-clock.js";

/*
 * Task 011-85, regression 4 (011 C11, Q5): a test that reads the root
 * `package.json` at run time re-keys on a version raise when its run observed
 * the read or it declares the file. With neither, it keeps its key, an
 * accepted miss: the hidden lockfile no longer carries the root's version.
 * Each file imports `child_process`, so its key holds the whole fingerprint.
 */
const READS = "test/reads.test.ts";
const DECLARES = "test/declares.test.ts";
const SPAWNS = "test/spawns.test.ts";
const reading = [
  'import "node:child_process";',
  'import { readFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'it("reads the root\'s version", () => {',
  '  const root = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));',
  "  expect(root.version).toMatch(/^1\\./);",
  "});",
  "",
].join("\n");
const FILES = {
  [READS]: reading,
  [DECLARES]: reading,
  [SPAWNS]: 'import "node:child_process";\nimport { it } from "vitest";\nit("spawns", () => {});\n',
};
const manifest = (version: string) =>
  `${JSON.stringify({ name: "app", version, private: true, type: "module" })}\n`;

/** The test files whose key a raise of the root's version moves, in `package.json` and the hidden lockfile. */
async function movedByRaise(options: HarnessOptions): Promise<string[]> {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  for (const [path, content] of Object.entries(FILES))
    writeFileSync(join(repo.main, path), content);
  writeFileSync(join(repo.main, "package.json"), manifest("1.4.0"));
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "reads the root's version"]);
  writeInstall(repo.main, {}, "1.4.0");
  const h = await openHarness(repo.main, store, repo.commonDir, options);
  await h.scheduler.start();
  await h.scheduler.idle();
  const paths = [...ALL_TEST_FILES, ...Object.keys(FILES)];
  const before = new Map(paths.map((path) => [path, h.keyOf(path)]));
  expect([...before.values()]).not.toContain(null);

  h.write("package.json", manifest("1.5.0"));
  writeInstall(h.root, {}, "1.5.0");
  await h.batch("package.json", "node_modules/.package-lock.json");
  // A file a declared input alone reaches is catch-up, which waits for quiet (row 011-153).
  await idleAfterQuiet(h);
  return paths.filter((path) => h.keyOf(path) !== before.get(path)).sort();
}

describe(
  "a raise of the root's version and a test that reads it (011-85, regression 4)",
  SLOW,
  () => {
    it("with observation on, re-keys each file whose run read package.json, and no other", async () => {
      expect(await movedByRaise({ observe: true })).toEqual([DECLARES, READS]);
    });

    it("with observation off, re-keys the file that declares package.json and keeps the key of one that only reads it", async () => {
      expect(await movedByRaise({ policy: { inputs: { [DECLARES]: ["package.json"] } } })).toEqual([
        DECLARES,
      ]);
    });
  },
);
