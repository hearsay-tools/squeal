// Throwaway (016-19). Copies Squeal's runtime-input recorder from this worktree's
// src/runners/observe/ into <dest>/src/runners/observe/ (that suffix keeps it a
// "Squeal recorder" for ownNodeOptions, so nested Squeal runs strip it as they strip the
// daemon's) and splits kind `f` into load, read, stat and exec. `f` is still written,
// so the recorder's own behaviour is unchanged; the sub-kinds are extra keys per line.
// Usage: node make-recorder.mjs <squeal-root> <dest>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, dest] = process.argv.slice(2);
const from = join(root, "src/runners/observe");
const to = join(dest, "src/runners/observe");
mkdirSync(to, { recursive: true });

function patch(name, edits) {
  let text = readFileSync(join(from, name), "utf8");
  for (const [before, after, count = 1] of edits) {
    const n = text.split(before).length - 1;
    if (n !== count) throw new Error(`${name}: expected ${count} of ${JSON.stringify(before)}, found ${n}`);
    text = text.split(before).join(after);
  }
  writeFileSync(join(to, name), text);
}

const SETS = "Object.fromEntries(KINDS.map((k) => [k, new Set()]))";
const ARRAYS = "Object.fromEntries(KINDS.map((k) => [k, []]))";
patch("recorder.cjs", [
  ['const KINDS = ["f", "l", "r", "w"];', 'const KINDS = ["f", "l", "r", "w", "load", "read", "stat", "exec"];\nconst SUB = new Set(["load", "read", "stat", "exec"]);'],
  ["known = { f: new Set(), l: new Set(), r: new Set(), w: new Set() };", `known = ${SETS};`],
  ["sets = { f: [], l: [], r: [], w: [] };", `sets = ${ARRAYS};`],
  ["const record = (kind, p, real = false) => {", "const record = (kind, p, real = false) => {\n    if (SUB.has(kind)) recordOne(\"f\", p, real);\n    recordOne(kind, p, real);\n  };\n  const recordOne = (kind, p, real = false) => {"],
  ['record("f", new URL(resolved.url', 'record("load", new URL(resolved.url'],
  ['record("f", process.argv[1]);', 'record("exec", process.argv[1]);'],
]);
patch("fs.cjs", [
  ['for (const name of ["readFile", "readFileSync", "createReadStream"]) wrap(target, name, "f");', 'for (const name of ["readFile", "readFileSync", "createReadStream"]) wrap(target, name, "read");'],
  ['for (const name of ["stat", "statSync", "lstat", "lstatSync", "exists", "existsSync"]) {\n      wrap(target, name, "f");', 'for (const name of ["stat", "statSync", "lstat", "lstatSync", "exists", "existsSync"]) {\n      wrap(target, name, "stat");'],
  ['for (const name of ["access", "accessSync", "realpath", "realpathSync"])\n      wrap(target, name, "f");', 'for (const name of ["access", "accessSync", "realpath", "realpathSync"])\n      wrap(target, name, "stat");'],
  ['if ((f & O_ACCMODE) !== O_WRONLY) api.record("f", abs);', 'if ((f & O_ACCMODE) !== O_WRONLY) api.record("read", abs);'],
  ['wrap(target, name, "f", 0);', 'wrap(target, name, "read", 0);'],
]);
patch("spawn.cjs", [
  ['          api.record("f", abs);', '          api.record("exec", abs);'],
  ['api.record("f", filename);', 'api.record("exec", filename);', 2],
]);
copyFileSync(join(from, "preloads.cjs"), join(to, "preloads.cjs"));
console.log(to);
