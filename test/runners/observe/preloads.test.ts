import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/*
 * Review 001-401, B2 (spec 001 D11 Fidelity): only a `--require` Node would
 * run makes the recorder a `--require`. Where a command cannot be read for
 * certain, a `-r` that could be Node's counts, which loses no reads.
 */

const { optionsRequire, shellRequires, spawnRequires } = createRequire(import.meta.url)(
  "../../../src/runners/observe/preloads.cjs",
) as {
  optionsRequire: (execArgv: readonly string[]) => boolean;
  shellRequires: (command: string) => boolean;
  spawnRequires: (file: string, args: readonly string[]) => boolean;
};

describe("a Node child's --require (review 001-401, B2)", () => {
  it("reads Node's option region, not its program's arguments", () => {
    const node = process.execPath;
    expect(spawnRequires(node, ["-r", "./pre.cjs", "a.js"])).toBe(true);
    expect(spawnRequires("node", ["--require=./pre.cjs", "a.js"])).toBe(true);
    expect(spawnRequires(node, ["--conditions", "dev", "-r", "./pre.cjs", "a.js"])).toBe(true);
    expect(spawnRequires(node, ["-e", "1", "-r", "./pre.cjs"])).toBe(true);
    expect(spawnRequires(node, ["a.js", "-r", "./x"])).toBe(false);
    expect(spawnRequires(node, ["a.js", " -r "])).toBe(false);
    expect(spawnRequires(node, ["-e", "1", "arg", "--require"])).toBe(false);
    expect(spawnRequires(node, ["--", "-r", "x"])).toBe(false);
  });

  it("reads a Node another program runs, and no other program's -r", () => {
    expect(spawnRequires("/usr/bin/env", ["X=1", "node", "-r", "x", "a.js"])).toBe(true);
    expect(spawnRequires("npx", ["node", "-r", "x", "a.js"])).toBe(true);
    expect(spawnRequires("rm", ["-r", "x"])).toBe(false);
    expect(spawnRequires("npx", ["mocha", "-r", "ts-node/register"])).toBe(false);
  });

  it("reads a shell's -c command as the shell passes its words on", () => {
    expect(spawnRequires("/bin/bash", ["-lc", "node '-r' x a.js"])).toBe(true);
    expect(spawnRequires("/bin/sh", ["script.sh", "-r"])).toBe(false);
    expect(shellRequires('cd x && FOO="a b" node "--require" x a.js')).toBe(true);
    expect(shellRequires("node -r x a.js >out 2>&1 &")).toBe(true);
    expect(shellRequires("rm -r x; node a.js -r y | cat")).toBe(false);
    expect(shellRequires("echo hi > -r; node 'a.js' '-r'")).toBe(false);
    expect(shellRequires("node a.js # -r x")).toBe(false);
    expect(shellRequires('node "$DIR/a.js"')).toBe(false);
  });

  it("counts a -r that could be Node's where the command cannot be read for certain", () => {
    expect(shellRequires("node $FLAGS a.js -r x")).toBe(true);
    expect(shellRequires("$NODE -r x a.js")).toBe(true);
    expect(shellRequires("node --some-new-flag value -r x a.js")).toBe(true);
    expect(shellRequires("node a.js <<EOF\n-r\nEOF")).toBe(true);
    expect(shellRequires("node '-r x")).toBe(true);
    expect(spawnRequires("cmd.exe", ["/d", "/s", "/c", "node -r x a.js"])).toBe(true);
  });

  it("reads a Worker's execArgv as options only", () => {
    expect(optionsRequire(["--require", "./pre.cjs"])).toBe(true);
    expect(optionsRequire(["--inspect", "--conditions", "-r"])).toBe(false);
    expect(optionsRequire([])).toBe(false);
  });
});
