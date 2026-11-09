import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { listingHash, readEvidence } from "../../../src/core/ci/inputs.js";
import { ABSENT_LISTING } from "../../../src/core/keys/observed.js";
import { takeRecorded } from "../../../src/runners/observe/read.js";
import { OBSERVE_VARIABLE, observeRecorder } from "../../../src/runners/observe/runtime.js";
import { CI_RECORD_VARIABLE, ciHook } from "../../../src/runners/vitest/ci-record.js";

/*
 * Spec 018 D8 and D9 (2026-11-09, review of 0.1.421 second round B1): the
 * evidence `squeal ci record`'s hook takes in a process, as it reads. A
 * file's content as git hashes it, at the read; a listing's names, each
 * directory's below a recursive one; an absent path as `null`; a module Node
 * loads, and one it fails to find. A path written, even with the content it
 * had, and a listing an entry was added to, have none. Beside the daemon's
 * recorder, the hook makes it observe nothing it would not observe alone, so
 * no key changes.
 */

const SCRIPT = `import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
readdirSync(".");
readFileSync("data/a.txt");
await readFile("data/b.txt", "utf8");
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

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-ci-evidence-")));
  temps.push(dir);
  return dir;
}

/** `root`, emptied and filled with `FILES` again. */
function fill(root: string): void {
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries({ ...FILES, "script.mjs": SCRIPT })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const preload = (path: string) => `--import=${pathToFileURL(path).href}`;

/** `node script.mjs` in `root`, with the CI hook taking evidence into `evidence`, the daemon's recorder into `observed`. */
function run(root: string, out: { evidence?: string; observed?: string }): void {
  const imports: string[] = [];
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  if (out.observed !== undefined) {
    imports.push(preload(observeRecorder() as string));
    const file = join(root, "test/a.test.ts");
    env[OBSERVE_VARIABLE] = JSON.stringify({ out: out.observed, root, skip: [], file });
  }
  if (out.evidence !== undefined) {
    imports.push(preload(ciHook() as string));
    const evidence = { out: out.evidence, root, skip: [], format: "sha1" };
    env[CI_RECORD_VARIABLE] = JSON.stringify({ evidence });
  }
  execFileSync(process.execPath, [...imports, "script.mjs"], { cwd: root, env, stdio: "pipe" });
}

const blob = (text: string) =>
  execFileSync("git", ["hash-object", "--stdin"], { input: text }).toString().trim();

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
