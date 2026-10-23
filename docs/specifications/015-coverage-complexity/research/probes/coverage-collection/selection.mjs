// Throwaway probe (015-01, Q7 and Q4 bytes): from lines.mjs records at HEAD,
// for recent commits that changed a source still unchanged at HEAD, how many
// sample test files load the source (file level, a lower bound of the static
// closure) against how many ran a line the commit added or changed (line level).
// Also the size of a compact record: per source, its file hash (20 bytes), a
// bitset of covered lines and one hit bit per function.
//
// node selection.mjs <records.json> <git dir> <commits>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [recordsFile, repo, count] = process.argv.slice(2);
const records = JSON.parse(readFileSync(recordsFile, "utf8"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });

const commits = git("log", "--format=%H", `-${count}`, "--", "src/").trim().split("\n");
let fileRuns = 0;
let lineRuns = 0;
let edits = 0;
const rows = [];
for (const c of commits) {
  const files = git("diff", "--name-only", `${c}^`, c, "--", "src/")
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const f of files) {
    if (git("diff", "--name-only", c, "HEAD", "--", f).trim() !== "") continue; // changed since: lines moved
    const changed = new Set();
    for (const m of git("diff", "-U0", `${c}^`, c, "--", f).matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(m[1]);
      const n = m[2] === undefined ? 1 : Number(m[2]);
      if (n === 0) {
        changed.add(start);
        changed.add(start + 1);
      } else for (let l = start; l < start + n; l++) changed.add(l);
    }
    if (changed.size === 0) continue;
    let file = 0;
    let line = 0;
    for (const sources of Object.values(records)) {
      const s = sources[f];
      if (!s) continue;
      file++;
      if (s.covered.some((l) => changed.has(l))) line++;
    }
    edits++;
    fileRuns += file;
    lineRuns += line;
    rows.push(`${c.slice(0, 8)} ${f} changed=${changed.size} file-level=${file} line-level=${line}`);
  }
}
console.log(rows.join("\n"));
console.log(
  `EDITS ${edits} (commits=${commits.length}) sample=${Object.keys(records).length} file-level runs=${fileRuns} line-level runs=${lineRuns}`,
);

let compact = 0;
let sources = 0;
for (const srcs of Object.values(records)) {
  for (const s of Object.values(srcs)) {
    sources++;
    const max = Math.max(0, ...s.lines);
    compact += 20 + Math.ceil(max / 8) + Math.ceil(s.functions.length / 8) + 4;
  }
}
const n = Object.keys(records).length;
console.log(
  `COMPACT records=${n} sources/record=${(sources / n).toFixed(1)} bytes/record=${Math.round(compact / n)} x950=${((compact / n) * 950 / 1048576).toFixed(1)} MiB`,
);
