import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/*
 * Reviews 001-401 and wave-13bt, B2 (spec 001 D11 Fidelity): only a
 * `--require` Node would run for certain makes the recorder a `--require`.
 * Where a command cannot be read before it runs, the answer is no: a false
 * `--require` can change a verdict, a false `--import` only loses reads.
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

  it("takes every option Node does not list as valued alone, and stops at the entry (wave-13bt)", () => {
    const node = process.execPath;
    expect(spawnRequires(node, ["--no-warnings", "/x/child.cjs", "-r"])).toBe(false);
    expect(spawnRequires(node, ["--no-warnings", "-r", "./pre.cjs", "a.js"])).toBe(true);
    expect(spawnRequires(node, ["--some-new-flag", "value", "-r", "x", "a.js"])).toBe(false);
    expect(spawnRequires(node, ["--title", "-r", "a.js"])).toBe(false);
    expect(spawnRequires(node, ["--input_type", "module", "-r", "x"])).toBe(true);
    expect(spawnRequires(node, ["--prof-process", "-r", "x"])).toBe(false);
  });

  it("reads a Node another program runs, and no other program's -r", () => {
    expect(spawnRequires("/usr/bin/env", ["X=1", "node", "-r", "x", "a.js"])).toBe(true);
    expect(spawnRequires("npx", ["node", "-r", "x", "a.js"])).toBe(true);
    expect(spawnRequires("rm", ["-r", "x"])).toBe(false);
    expect(spawnRequires("npx", ["mocha", "-r", "ts-node/register"])).toBe(false);
    expect(spawnRequires("git", ["grep", "node", "-r"])).toBe(false);
    expect(spawnRequires("env", ["-S", "node -r x", "a.js"])).toBe(false);
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

  it("finds a Node only in command position", () => {
    expect(shellRequires("printf '%s' node -r >/dev/null; node a.js")).toBe(false);
    expect(shellRequires("echo node -r x")).toBe(false);
    expect(shellRequires("command -v node -r")).toBe(false);
    expect(shellRequires("if node -r x a.js; then :; fi")).toBe(true);
    expect(shellRequires("env -u FOO X=1 exec node --no-warnings -r x a.js")).toBe(true);
  });

  it("reads past a here-document's body, never into it", () => {
    expect(shellRequires("node a.js <<EOF\n-r\nEOF")).toBe(false);
    expect(shellRequires("cat <<-'EOF'\n\tnode -r x a.js\n\tEOF\nnode a.js")).toBe(false);
    expect(shellRequires("cat <<EOF\nbody\nEOF\nnode -r x a.js")).toBe(true);
    expect(shellRequires("node -r x a.js <<EOF")).toBe(false);
  });

  it("keeps the --import where the shell has yet to expand Node's options", () => {
    expect(shellRequires("node $FLAGS a.js -r x")).toBe(false);
    expect(shellRequires('node "$(printf %s -r)" ./pre.cjs a.js')).toBe(false);
    expect(shellRequires("$NODE -r x a.js")).toBe(false);
    expect(shellRequires("node --title $T -r x a.js")).toBe(false);
    expect(shellRequires("node -* a.js")).toBe(false);
    expect(shellRequires("node '-r x")).toBe(false);
    expect(spawnRequires("cmd.exe", ["/d", "/s", "/c", "node -r x a.js"])).toBe(false);
    // what the shell expands after a certain -r, or as one word into a value, leaves it Node's
    expect(shellRequires('node -r "$PRE" $REST a.js')).toBe(true);
    expect(shellRequires('node --title "$T" -r x a.js')).toBe(true);
  });

  it("reads a Worker's execArgv as options only", () => {
    expect(optionsRequire(["--require", "./pre.cjs"])).toBe(true);
    expect(optionsRequire(["--inspect", "--conditions", "-r"])).toBe(false);
    expect(optionsRequire([])).toBe(false);
  });
});
