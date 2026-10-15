import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

/*
 * Review wave-13bt, B2 and S2 (spec 001 D11 Fidelity): a child runs as it
 * would without Squeal. A `--require` recorder makes Node parse the nearest
 * `package.json`, so it goes only to a child whose Node runs a `--require`
 * for certain; a program's `-r`, an option Node takes alone, and a command
 * the shell has yet to expand leave it an `--import`.
 */

/** Runs each child beside a `package.json` that is not JSON, and prints `[status, stdout, stderr]`. */
const MAIN = [
  'import { spawnSync } from "node:child_process";',
  'import { writeFileSync } from "node:fs";',
  'writeFileSync("bad/package.json", "{ broken");',
  "const child = new URL('./plain.cjs', import.meta.url).pathname;",
  "const node = JSON.stringify(process.execPath);",
  "const sh = (command) => spawnSync('/bin/sh', ['-c', command], { cwd: 'bad', env: { FLAGS: '' }, encoding: 'utf8' });",
  "const runs = [",
  "  spawnSync(process.execPath, ['--no-warnings', child, '-r'], { cwd: 'bad', env: {}, encoding: 'utf8' }),",
  "  sh(node + ' $FLAGS ' + JSON.stringify(child) + ' -r'),",
  "  sh(node + ' ' + JSON.stringify(child) + ' <<EOF\\n-r\\nEOF'),",
  "  sh(\"printf '%s' node -r >/dev/null; \" + node + ' ' + JSON.stringify(child)),",
  "];",
  "process.stdout.write(JSON.stringify(runs.map((r) => [r.status, r.stdout, r.stderr])));",
].join("\n");

describe("a child's verdict under the recorder (review wave-13bt, B2)", { timeout: 60_000 }, () => {
  it("is the plain run's beside a malformed package.json, for a -r Node does not run", () => {
    const files = {
      "main.mjs": MAIN,
      "bad/.keep": "",
      "plain.cjs": "process.stdout.write('ok');\n",
    };
    const plain = JSON.parse(observe(files, "main.mjs", { off: true }).stdout);
    const observed = JSON.parse(observe(files).stdout);
    expect(plain).toEqual(Array(4).fill([0, "ok", ""]));
    expect(observed).toEqual(plain);
  });

  it("loses the reads of a preload whose -r the shell expands, the named limit (S2)", () => {
    const seen = observe({
      "main.mjs": [
        'import { spawnSync } from "node:child_process";',
        "const node = JSON.stringify(process.execPath);",
        "const r = spawnSync('/bin/sh', ['-c', node + ' \"$(printf %s -r)\" ./pre.cjs child.cjs'], { env: {}, encoding: 'utf8' });",
        "process.stdout.write(r.stdout);",
      ].join("\n"),
      "pre.cjs":
        'globalThis.pre = require("node:fs").readFileSync(__dirname + "/input.txt", "utf8");\n',
      "input.txt": "secret",
      "child.cjs": "process.stdout.write(String(globalThis.pre));\n",
    });
    // the child runs its preload, and the recorder, an `--import`, starts after it
    expect(seen.stdout).toBe("secret");
    expect(seen.paths).toContain("child.cjs");
    expect(seen.paths).not.toContain("input.txt");
  });
});
