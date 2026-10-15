import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

/*
 * Review 001-401, B1 and B2 (spec 001 D11 Fidelity): the recorder takes its
 * form at every spawn, also when the child inherits it already, so a child's or
 * a Worker's own `--require` runs after it and its reads are recorded. Only a
 * `--require` Node would run counts: one in Node's option region, in the
 * shell's words as the shell passes them, or in `NODE_OPTIONS`; never a
 * program's argument.
 */

/** `pre-<n>.cjs` reads `pre-<n>.txt` into `globalThis.pre`. */
const preloads = (...names: string[]) =>
  Object.fromEntries(
    names.flatMap((n) => [
      [
        `pre-${n}.cjs`,
        `globalThis.pre = require("node:fs").readFileSync(__dirname + "/pre-${n}.txt", "utf8");\n`,
      ],
      [`pre-${n}.txt`, n],
    ]),
  );

/** Prints its preload's value and how often the recorder sits in its `NODE_OPTIONS`. */
const CHILD = [
  "const options = process.env.NODE_OPTIONS ?? '';",
  "const form = options.startsWith('--require') ? 'require' : options.startsWith('--import') ? 'import' : 'none';",
  "process.stdout.write(JSON.stringify([String(globalThis.pre), form, options.split('recorder.cjs').length - 1]));",
].join("\n");

describe("the recorder's form at each spawn (review 001-401)", { timeout: 60_000 }, () => {
  it("is a --require for a child with its own --require under the inherited env, and once", () => {
    const seen = observe({
      "main.mjs": [
        'import { spawnSync, execFileSync } from "node:child_process";',
        "const run = (pre, env) => spawnSync(process.execPath, ['--require', './pre-' + pre + '.cjs', 'child.cjs'], { ...(env ? { env } : {}), encoding: 'utf8' }).stdout;",
        "const a = run('a');",
        "const b = run('b', { ...process.env });",
        "const c = execFileSync(process.execPath, ['-r', './pre-c.cjs', 'child.cjs'], { encoding: 'utf8' });",
        "process.stdout.write(JSON.stringify([a, b, c].map((s) => JSON.parse(s))));",
      ].join("\n"),
      ...preloads("a", "b", "c"),
      "child.cjs": CHILD,
    });
    expect(JSON.parse(seen.stdout)).toEqual([
      ["a", "require", 1],
      ["b", "require", 1],
      ["c", "require", 1],
    ]);
    expect(seen.paths).toEqual(expect.arrayContaining(["pre-a.txt", "pre-b.txt", "pre-c.txt"]));
  });

  it("goes back to --import for a grandchild without one, and to --require for one with one", () => {
    const seen = observe({
      "main.mjs": [
        'import { spawnSync } from "node:child_process";',
        "const r = spawnSync(process.execPath, ['--require', './pre-a.cjs', 'mid.cjs'], { encoding: 'utf8' });",
        "process.stdout.write(r.stdout);",
      ].join("\n"),
      "mid.cjs": [
        'const { spawnSync } = require("node:child_process");',
        "const plain = spawnSync(process.execPath, ['child.cjs'], { encoding: 'utf8' }).stdout;",
        "const own = spawnSync(process.execPath, ['--require', './pre-g.cjs', 'child.cjs'], { encoding: 'utf8' }).stdout;",
        "process.stdout.write(JSON.stringify([JSON.parse(plain), JSON.parse(own)]));",
      ].join("\n"),
      ...preloads("a", "g"),
      "child.cjs": CHILD,
    });
    // the plain grandchild inherits the mid child's preload in no way: it runs without it
    expect(JSON.parse(seen.stdout)).toEqual([
      ["undefined", "import", 1],
      ["g", "require", 1],
    ]);
    expect(seen.paths).toEqual(expect.arrayContaining(["pre-a.txt", "pre-g.txt", "mid.cjs"]));
  });

  it("records a Worker's execArgv --require under its default, empty and shared env, and its child's", () => {
    const seen = observe({
      "main.mjs": [
        'import { Worker, SHARE_ENV } from "node:worker_threads";',
        "const before = process.env.NODE_OPTIONS;",
        "const run = (pre, env) => new Promise((resolve, reject) => {",
        "  const w = new Worker('./thread.cjs', { ...(env === undefined ? {} : { env }), execArgv: ['--require', './pre-' + pre + '.cjs'] });",
        "  w.once('message', resolve); w.once('error', reject);",
        "});",
        "const out = [await run('d'), await run('e', {}), await run('s', SHARE_ENV)];",
        // the shared env is the parent's own: the recorder leaves it as it was
        "out.push(process.env.NODE_OPTIONS === before);",
        "process.stdout.write(JSON.stringify(out));",
      ].join("\n"),
      "thread.cjs": [
        'const { parentPort } = require("node:worker_threads");',
        'const { spawnSync } = require("node:child_process");',
        "const child = spawnSync(process.execPath, ['--require', './pre-c.cjs', 'child.cjs'], { encoding: 'utf8' }).stdout;",
        "parentPort.postMessage([String(globalThis.pre), JSON.parse(child)]);",
      ].join("\n"),
      ...preloads("d", "e", "s", "c"),
      "child.cjs": CHILD,
    });
    const [d, e, s, unchanged] = JSON.parse(seen.stdout);
    expect([d[0], e[0], s[0], unchanged]).toEqual(["d", "e", "s", true]);
    for (const thread of [d, e, s]) expect(thread[1]).toEqual(["c", "require", 1]);
    expect(seen.paths).toEqual(
      expect.arrayContaining(["pre-d.txt", "pre-e.txt", "pre-s.txt", "pre-c.txt"]),
    );
  });

  it("finds -r and --require in a shell's command, unquoted, single- or double-quoted", () => {
    const seen = observe({
      "main.mjs": [
        'import { spawnSync, execSync } from "node:child_process";',
        "const node = JSON.stringify(process.execPath);",
        "const sh = (command) => spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' }).stdout;",
        "const out = [",
        "  sh(node + ' -r ./pre-a.cjs child.cjs'),",
        "  sh(node + \" '-r' ./pre-b.cjs child.cjs\"),",
        '  sh(node + \' "--require" "./pre-c.cjs" child.cjs\'),',
        "  sh('cd . && X=1 ' + node + \" '--require=./pre-d.cjs' child.cjs 2>&1\"),",
        "  execSync(node + ' \"-r\" ./pre-e.cjs child.cjs', { encoding: 'utf8' }),",
        "];",
        "process.stdout.write(JSON.stringify(out.map((s) => JSON.parse(s))));",
      ].join("\n"),
      ...preloads("a", "b", "c", "d", "e"),
      "child.cjs": CHILD,
    });
    const out = JSON.parse(seen.stdout) as [string, string, number][];
    expect(out.map(([pre, form]) => [pre, form])).toEqual(
      ["a", "b", "c", "d", "e"].map((n) => [n, "require"]),
    );
    expect(seen.paths).toEqual(
      expect.arrayContaining(["pre-a.txt", "pre-b.txt", "pre-c.txt", "pre-d.txt", "pre-e.txt"]),
    );
  });

  it("leaves a -r after a child's entry, or a shell's rm -r, to the program: the child starts beside a package.json that is not JSON", () => {
    const seen = observe({
      "main.mjs": [
        'import { spawnSync } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        'writeFileSync("bad/package.json", "{ broken");',
        "const child = new URL('./plain.cjs', import.meta.url).pathname;",
        "const node = JSON.stringify(process.execPath);",
        "const options = { cwd: 'bad', encoding: 'utf8' };",
        "const runs = [",
        "  spawnSync(process.execPath, [child, ' -r '], options),",
        "  spawnSync(process.execPath, [child, '-r', './x.cjs'], options),",
        "  spawnSync(process.execPath, ['-e', 'process.stdout.write(\\'ok\\')', 'arg', '--require'], options),",
        "  spawnSync('/bin/sh', ['-c', 'rm -rf gone && ' + node + ' ' + child + ' -r x'], options),",
        "];",
        "process.stdout.write(JSON.stringify(runs.map((r) => [r.status, r.stdout, r.stderr])));",
      ].join("\n"),
      "bad/.keep": "",
      "plain.cjs": "process.stdout.write('ok');\n",
    });
    expect(JSON.parse(seen.stdout)).toEqual(Array(4).fill([0, "ok", ""]));
  });
});
