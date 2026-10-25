import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import { observedClosure } from "../../../src/runners/node-test/run/observed.js";
import { nodeTestRuntime } from "../../../src/runners/node-test/runtime.js";

/*
 * Spec 016 D4, the written-directory bound (Q3 (a), the coordinator,
 * 2026-10-25): node:test's module recorder records each directory create
 * and remove, in every form, and no file write; `observedClosure` reports
 * the directories above what the run loaded as `written`.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Runs `main.mjs` of `files` under the recorder; the recorder's files of the run. */
function record(files: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-written-")));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const out = join(root, ".graph");
  mkdirSync(out);
  execFileSync(process.execPath, ["--require", nodeTestRuntime().recorder, "main.mjs"], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", SQUEAL_NODE_TEST_GRAPH: join(out, "graph-0") },
  });
  const graphs = readdirSync(out).map((name) => readFileSync(join(out, name), "utf8"));
  const written = graphs
    .flatMap((text) => text.split("\n"))
    .filter((line) => line.includes('"written"'))
    .map((line) => (JSON.parse(line) as { written: string }).written.slice(root.length + 1));
  return { root, graphs, written };
}

describe("node:test's recorder: directory creates and removes (016 D4)", () => {
  it("records each form of mkdir, mkdtemp, rm, rmdir and rename, and no file write", () => {
    const { written } = record({
      "main.mjs": [
        'import * as fs from "node:fs";',
        'import { createRequire } from "node:module";',
        "const { promises } = fs;",
        'const viaRequire = createRequire(import.meta.url)("node:fs");',
        "const done = (f, ...args) => new Promise((ok, no) => f(...args, (e, r) => (e ? no(e) : ok(r))));",
        'fs.mkdirSync("m-sync");',
        'await done(fs.mkdir, "m-cb");',
        'await promises.mkdir("m-promise");',
        'viaRequire.mkdirSync("m-require");',
        'const temps = [fs.mkdtempSync("t-sync-"), await done(fs.mkdtemp, "t-cb-"), await promises.mkdtemp("t-promise-")];',
        'for (const dir of ["r-sync", "r-cb", "r-promise", "d-sync", "d-cb", "d-promise", "n-sync", "n-cb", "n-promise"]) fs.mkdirSync(dir + "-src", { recursive: true });',
        'fs.rmSync("r-sync-src", { recursive: true });',
        'await done(fs.rm, "r-cb-src", { recursive: true });',
        'await promises.rm("r-promise-src", { recursive: true });',
        'fs.rmdirSync("d-sync-src");',
        'await done(fs.rmdir, "d-cb-src");',
        'await promises.rmdir("d-promise-src");',
        'fs.renameSync("n-sync-src", "n-sync-to");',
        'await done(fs.rename, "n-cb-src", "n-cb-to");',
        'await promises.rename("n-promise-src", "n-promise-to");',
        'fs.writeFileSync("file.txt", "x");',
        "process.stdout.write(temps.join(','));",
      ].join("\n"),
    });
    const temps = written.filter((p) => p.startsWith("t-")).sort();
    expect(temps).toEqual([
      expect.stringMatching(/^t-cb-\w{6}$/),
      expect.stringMatching(/^t-promise-\w{6}$/),
      expect.stringMatching(/^t-sync-\w{6}$/),
    ]);
    // the `-src` directories the script made for the removes are created first: recorded too
    const others = written.filter((p) => !p.startsWith("t-")).sort();
    expect(others).toEqual(
      [
        "m-cb",
        "m-promise",
        "m-require",
        "m-sync",
        ...["d", "n", "r"].flatMap((op) =>
          ["cb", "promise", "sync"].map((form) => `${op}-${form}-src`),
        ),
        "n-cb-to",
        "n-promise-to",
        "n-sync-to",
      ].sort(),
    );
    expect(written).not.toContain("file.txt");
  });

  it("reports as written only the directories above what the run loaded", () => {
    const { root, graphs } = record({
      "main.mjs": [
        'import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";',
        'import { join, resolve } from "node:path";',
        'import { pathToFileURL } from "node:url";',
        'mkdirSync("unrelated");',
        'const dir = mkdtempSync(join("scratch", "u-"));',
        'writeFileSync(join(dir, "m.mjs"), "export const m = 1;\\n");',
        "await import(pathToFileURL(resolve(dir, 'm.mjs')).href);",
        'await import("./lib/kept.mjs");',
      ].join("\n"),
      "lib/kept.mjs": "export const kept = 1;\n",
      "scratch/.keep": "",
    });
    const closure = observedClosure(
      { project: "", path: "main.mjs" },
      join(root, "main.mjs"),
      graphs,
      new Set(),
      new WorktreePaths(root),
    );
    const scratch = closure?.paths.find((p) => p.startsWith("scratch/u-")) ?? "";
    expect(closure?.paths).toEqual(["lib/kept.mjs", "main.mjs", scratch]);
    expect(closure?.written).toEqual([dirname(scratch)]);
    expect(closure?.direct).toEqual([]);
  });
});
