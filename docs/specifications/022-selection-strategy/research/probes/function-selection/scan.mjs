// Throwaway text scan for Q3 (a) and (b): reflection on function text and
// assertions on line numbers or stack text, in test files and snapshots,
// and project code that turns call positions into values. A text scan:
// matches in strings and comments count, indirect uses do not.
//   node scan.mjs <root> <test-regex> <src-regex> [<bare-git-dir> (list files from its HEAD tree)]
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [root, testRe, srcRe, bare] = process.argv.slice(2);
const files = execFileSync("git", bare ? ["--git-dir", bare, "ls-tree", "-r", "--name-only", "HEAD"] : ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 1e9 }).split("\n").filter(Boolean);
const tests = files.filter((f) => new RegExp(testRe).test(f));
const srcs = files.filter((f) => new RegExp(srcRe).test(f) && !new RegExp(testRe).test(f));
const snaps = files.filter((f) => f.endsWith(".snap"));
const read = (f) => { try { return readFileSync(join(root, f), "utf8"); } catch { return ""; } };
const imported = (text) => {
  const names = new Set();
  for (const m of text.matchAll(/import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))?\s*from\s*["'](\.{1,2}\/[^"']+|@[^"']*\/[^"']+)["']/g)) {
    if (m[0].startsWith("import type")) continue;
    if (m[1]) names.add(m[1]);
    if (m[3]) names.add(m[3]);
    for (const part of (m[2] ?? "").split(",")) { const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop(); if (n && /^\w+$/.test(n) && !part.trim().startsWith("type ")) names.add(n); }
  }
  return names;
};
const count = {};
const lines = {};
const hit = (k, f) => (count[k] ??= new Set()).add(f);
for (const f of tests) {
  const t = read(f);
  const names = imported(t);
  for (const n of names) {
    const e = n.replace(/\$/g, "\\$");
    const a = t.match(new RegExp(`\\b${e}(\\.\\w+)*\\.toString\\(\\)`));
    const b = t.match(new RegExp(`\\bString\\(\\s*${e}(\\.\\w+)*\\s*\\)`));
    const c = t.match(new RegExp(`\\$\\{\\s*${e}\\s*\\}`));
    if (a) { hit("a1:imported name .toString()", f); (lines["a1"] ??= []).push(`${f}: ${a[0]}`); }
    if (b) { hit("a2:String(imported name)", f); (lines["a2"] ??= []).push(`${f}: ${b[0]}`); }
    if (c) hit("a3:${imported name} in a template (mostly constants)", f);
  }
  if (/Function\.prototype\.toString/.test(t)) hit("a:Function.prototype.toString", f);
  if (/new Function\(|eval:\s*true|\.toSource\(/.test(t)) hit("a:new Function / worker eval", f);
  if (/\.toString\(\)/.test(t)) hit("a:any .toString() (broad)", f);
  if (/\.stack\b/.test(t)) hit("b:reads .stack", f);
  if (/toMatch(Inline|File)?Snapshot|toThrowErrorMatching(Inline)?Snapshot/.test(t)) hit("b:uses snapshots", f);
  if (/["'`][^"'`\n]*\.(?:m|c)?[jt]sx?:\d+(?::\d+)?/.test(t)) hit("b:string holds file:line", f);
  if (/\b(line|lineNumber|column)\b["']?\s*[:=,)]\s*\d+|\.line\)\s*\.\s*to(Be|Equal)\(\s*\d+/.test(t)) hit("b:line/column number literal", f);
  if (/(location|\.line|lineNumber)[\w.]*\)?\s*\.\s*to(Be|Equal|StrictEqual)\(/.test(t)) hit("b:asserts a line/location", f);
}
const stackSnaps = snaps.filter((f) => /\.(?:m|c)?[jt]sx?:\d+(?::\d+)?|^\s+at .+\(/m.test(read(f)));
const srcStack = srcs.filter((f) => /new Error\(\)\.stack|captureStackTrace|prepareStackTrace|getFileName\(\)|getLineNumber\(\)/.test(read(f)));
console.log(JSON.stringify({
  root, testFiles: tests.length, sourceFiles: srcs.length, snapshotFiles: snaps.length,
  counts: Object.fromEntries(Object.entries(count).map(([k, v]) => [k, v.size])).valueOf(),
  snapshotsWithFileLineOrFrames: stackSnaps.length, sourcesReadingStacks: srcStack,
  samples: Object.fromEntries(Object.entries(count).map(([k, v]) => [k, [...v].slice(0, 8)])),
  snapshotSamples: stackSnaps.slice(0, 8), matches: lines,
}, null, 1));
