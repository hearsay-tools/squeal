import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listingHash, readEvidence } from "../../../src/core/ci/inputs.js";
import { ABSENT_LISTING } from "../../../src/core/keys/observed.js";
import { takeRecorded } from "../../../src/runners/observe/read.js";
import { blob, fill as fillWith, run, temp } from "./ci-evidence-kit.js";

/*
 * Spec 018 D8 and D9 (2026-11-09, review of 0.1.421 second round B1): the
 * evidence `squeal ci record`'s hook takes in a process, as it reads. A
 * file's content as git hashes it, at the read; a listing's names, each
 * directory's below a recursive one; an absent path as `null`; a module Node
 * loads, and one it fails to find. A path written, even with the content it
 * had, and a listing an entry was added to, have none. Beside the daemon's
 * recorder, the hook makes it observe nothing it would not observe alone, so
 * no key changes, reads through a descriptor or file handle included.
 */

const SCRIPT = `import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
readdirSync(".");
readFileSync("data/a.txt");
await readFile("data/b.txt", "utf8");
const fd = openSync("data/a.txt", "r");
readSync(fd, Buffer.alloc(2), 0, 2, 0);
closeSync(fd);
const handle = await open("data/b.txt", "r");
await handle.readFile();
await handle.close();
existsSync("missing.txt");
statSync("present.txt");
readdirSync("dir");
readdirSync("tree", { recursive: true });
try { readdirSync("nodir"); } catch {}
writeFileSync("same.txt", readFileSync("same.txt"));
readdirSync("grows");
writeFileSync("grows/new.txt", "n");
mkdirSync("made/deep", { recursive: true });
readFileSync("node_modules/pkg/index.js");
await import("./mod.mjs");
await import("./nope.mjs").catch(() => {});
`;

const FILES: Record<string, string> = {
  "script.mjs": "",
  "data/a.txt": "a\n",
  "data/b.txt": "b\n",
  "present.txt": "p\n",
  "dir/one.txt": "1",
  "dir/two/x.txt": "x",
  "tree/top.txt": "t",
  "tree/sub/deeper/leaf.txt": "l",
  "tree/sub/mid.txt": "m",
  "same.txt": "same\n",
  "grows/old.txt": "o",
  "node_modules/pkg/index.js": "module.exports = 1;\n",
  "mod.mjs": "export const m = 1;\n",
};

/** `root`, emptied and filled with `FILES` again. */
const fill = (root: string) => fillWith(root, { ...FILES, "script.mjs": SCRIPT });

describe("the CI hook's evidence (spec 018 D9)", () => {
  it("takes each read, listing and probe as the run makes it, and no path it wrote", () => {
    const root = join(temp(), "root");
    fill(root);
    const evidence = temp();
    const listings = Object.fromEntries(
      ["dir", "tree", "tree/sub", "tree/sub/deeper"].map((dir) => [
        `${dir}/`,
        listingHash(root, dir),
      ]),
    );
    run(root, { evidence });
    expect(readEvidence(evidence)).toEqual({
      ...listings,
      "data/a.txt": blob("a\n"),
      "data/b.txt": blob("b\n"),
      "missing.txt": null,
      "mod.mjs": blob("export const m = 1;\n"),
      "nodir/": ABSENT_LISTING,
      "nope.mjs": null,
      "present.txt": blob("p\n"),
      "script.mjs": blob(SCRIPT),
    });
  });

  it("leaves what the daemon's recorder observes as it is", () => {
    const root = join(temp(), "root");
    fill(root);
    const alone = temp();
    run(root, { observed: alone });
    fill(root);
    const beside = temp();
    run(root, { observed: beside, evidence: temp() });
    const recorded = (dir: string) => [...takeRecorded(dir)];
    const before = recorded(alone);
    expect(before.length).toBe(1);
    expect(recorded(beside)).toEqual(before);
  });
});
