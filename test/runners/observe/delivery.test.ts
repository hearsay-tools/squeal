import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { observeEnv, observeRecorder } from "../../../src/runners/observe/index.js";
import { observe } from "./helpers.js";

/*
 * Task 001-390, spec 001 D11 Fidelity (research injected-environment F1, O1):
 * the recorder rides in `NODE_OPTIONS` as `--import` of its `file:` URL, so a
 * child whose nearest `package.json` is not JSON starts as it does without
 * Squeal. Every `--require` preload makes Node parse that file first. Beside a
 * project's own `--require` the recorder stays a `--require`, which runs before
 * it, so the preload's reads are still seen; plain Node parses the file then too.
 */

const recorder = observeRecorder(
  new URL("../../../src/runners/observe/runtime.ts", import.meta.url),
) as string;
const settings = { out: "/out", root: "/root", skip: [] };

/** `main.mjs`: writes a `package.json` that is not JSON in `bad/`, then runs `child.cjs` there with each env. */
const BAD_PACKAGE = {
  "main.mjs": [
    'import { spawnSync, execFileSync } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("bad/package.json", "export const value = 1;\\n");',
    "const child = new URL('./child.cjs', import.meta.url).pathname;",
    "const run = (env) => spawnSync(process.execPath, [child], { cwd: 'bad', env, encoding: 'utf8' });",
    "const inherit = run({ ...process.env });",
    "const empty = run({});",
    "const sync = execFileSync(process.execPath, [child], { cwd: 'bad', encoding: 'utf8' });",
    "process.stdout.write(JSON.stringify([inherit.status, inherit.stderr, empty.status, empty.stderr, sync]));",
  ].join("\n"),
  "bad/.keep": "",
  "child.cjs":
    'process.stdout.write(require("node:fs").readFileSync(__dirname + "/data.txt", "utf8"));\n',
  "data.txt": "d",
};

describe("observe recorder delivery (task 001-390)", { timeout: 60_000 }, () => {
  it("is an --import of the recorder's file: URL, ahead of what was inherited", () => {
    const url = JSON.stringify(pathToFileURL(recorder).href);
    expect(observeEnv(recorder, settings, undefined).NODE_OPTIONS).toBe(`--import ${url}`);
    expect(observeEnv(recorder, settings, " --import tsx ").NODE_OPTIONS).toBe(
      `--import ${url} --import tsx`,
    );
  });

  it("stays a --require beside a project's own --require, however written", () => {
    const path = JSON.stringify(recorder);
    for (const inherited of ["--require ./pre.cjs", "-r ./pre.cjs", '"--require=./pre.cjs"']) {
      expect(observeEnv(recorder, settings, inherited).NODE_OPTIONS).toBe(
        `--require ${path} ${inherited}`,
      );
    }
  });

  it("starts a child whose package.json is not JSON, under the inherited env and env {}, and records it", () => {
    const seen = observe(BAD_PACKAGE);
    expect(JSON.parse(seen.stdout)).toEqual([0, "", 0, "", "d"]);
    expect(seen.paths).toEqual(expect.arrayContaining(["child.cjs", "data.txt", "main.mjs"]));
  });

  it("beside a project --require, records what that preload reads and gives it to every child", () => {
    const seen = observe(
      {
        "main.mjs": [
          'import { spawnSync } from "node:child_process";',
          "const child = spawnSync(process.execPath, ['child.cjs'], { env: {}, encoding: 'utf8' });",
          "process.stdout.write(JSON.stringify([globalThis.preloaded, child.stdout]));",
        ].join("\n"),
        "pre.cjs":
          'globalThis.preloaded = require("node:fs").readFileSync(__dirname + "/pre.txt", "utf8");\n',
        "pre.txt": "p",
        "child.cjs": "process.stdout.write(String(globalThis.preloaded));\n",
      },
      "main.mjs",
      { inherited: "--require ./pre.cjs" },
    );
    // env {} drops the project's preload; the recorder, re-injected, needs no --require then
    expect(JSON.parse(seen.stdout)).toEqual(["p", "undefined"]);
    expect(seen.paths).toEqual(expect.arrayContaining(["pre.cjs", "pre.txt", "child.cjs"]));
  });

  it("stays a --require for a child with its own argv --require or a Worker's execArgv one", () => {
    const seen = observe({
      "main.mjs": [
        'import { spawnSync, execSync } from "node:child_process";',
        'import { Worker } from "node:worker_threads";',
        "const options = { env: {}, encoding: 'utf8' };",
        "const a = spawnSync(process.execPath, ['--require', './pre-a.cjs', 'child.cjs'], options);",
        "const b = spawnSync(process.execPath, ['--require=./pre-b.cjs', 'child.cjs'], options);",
        "const c = execSync(JSON.stringify(process.execPath) + ' -r ./pre-c.cjs child.cjs', options);",
        "const w = new Worker('./thread.cjs', { env: {}, execArgv: ['--require', './pre-w.cjs'] });",
        "await new Promise((r) => w.once('exit', r));",
        "process.stdout.write(JSON.stringify([a.stdout, b.stdout, c]));",
      ].join("\n"),
      ...Object.fromEntries(
        ["a", "b", "c", "w"].map((n) => [
          `pre-${n}.cjs`,
          `globalThis.pre = require("node:fs").readFileSync(__dirname + "/pre-${n}.txt", "utf8");\n`,
        ]),
      ),
      ...Object.fromEntries(["a", "b", "c", "w"].map((n) => [`pre-${n}.txt`, n])),
      "child.cjs": "process.stdout.write(String(globalThis.pre));\n",
      "thread.cjs": "",
    });
    expect(JSON.parse(seen.stdout)).toEqual(["a", "b", "c"]);
    // a preload's reads before the recorder's own --import would go unseen
    expect(seen.paths).toEqual(
      expect.arrayContaining(["pre-a.txt", "pre-b.txt", "pre-c.txt", "pre-w.txt"]),
    );
  });
});
