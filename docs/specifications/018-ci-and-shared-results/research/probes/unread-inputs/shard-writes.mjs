// Throwaway probe (row 018-56). From one re-recorded shard (record-shard.sh): what its hooked
// processes wrote, whether any write or conflicting read touches an input the export left
// out as unread (rules.mjs kinds C and D), and what changed in the checkout between start and end.
// Usage: node shard-writes.mjs <shard dir> <uncertified.json> <checkout>
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [shardDir, uncertifiedFile, checkout] = process.argv.slice(2);
const values = new Map();
const written = new Set();
const trees = new Set();
for (const name of readdirSync(join(shardDir, "evidence")))
  for (const text of readFileSync(join(shardDir, "evidence", name), "utf8").split("\n")) {
    if (!text) continue;
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    for (const [p, v] of Object.entries(line.e ?? {})) (values.get(p) ?? values.set(p, new Set()).get(p)).add(v);
    for (const p of line.w ?? []) written.add(p);
    for (const p of line.t ?? []) trees.add(p);
  }
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z"], { cwd: checkout, maxBuffer: 1 << 30 }).toString().split("\0").filter(Boolean),
);
const conflicting = [...values].filter(([, v]) => v.size > 1).map(([p]) => p);
const below = (p) => {
  const bare = p.endsWith("/") ? p.slice(0, -1) : p;
  return [...trees].some((t) => t === "" || bare === t || bare.startsWith(`${t}/`));
};
console.log(`evidence paths ${values.size}, conflicting ${conflicting.length}, written ${written.size}, written trees ${trees.size}`);
console.log(`written paths that are tracked files: ${[...written].filter((p) => tracked.has(p)).length}`);
for (const p of [...written].filter((p) => tracked.has(p)).slice(0, 20)) console.log(`  written tracked: ${p}`);
console.log(`written trees: ${[...trees].slice(0, 20).join(", ")}`);

// The shard's own test files, from its parts.
const own = new Set();
for (const n of readdirSync(join(shardDir, "parts")))
  for (const f of JSON.parse(readFileSync(join(shardDir, "parts", n), "utf8")).testFiles) own.add(f.path);
const uncertified = JSON.parse(readFileSync(uncertifiedFile, "utf8")).filter((f) => own.has(f.testFile.path));
let pairs = 0;
let unreadHere = 0;
const touched = new Map();
for (const { testFile, inputs } of uncertified)
  for (const input of inputs) {
    pairs += 1;
    const t = values.has(input) ? (values.get(input).size > 1 ? "conflicting read" : "read") : written.has(input) || below(input) ? "written" : null;
    if (t === null) unreadHere += 1;
    else touched.set(`${t}\t${input}`, [...(touched.get(`${t}\t${input}`) ?? []), testFile.path]);
  }
console.log(`left-out files of this shard (from the CI run): ${uncertified.length}, pairs ${pairs}`);
console.log(`pairs this re-recorded shard also never read, listed or wrote: ${unreadHere}`);
for (const [k, files] of touched) console.log(`  ${k}: ${files.length} files`);
for (const f of ["status-before.txt", "status-after.txt"]) {
  const lines = readFileSync(join(shardDir, f), "utf8").split("\n").filter(Boolean);
  const kinds = {};
  for (const l of lines) kinds[l[0]] = (kinds[l[0]] ?? 0) + 1;
  console.log(`${f}: ${JSON.stringify(kinds)}`);
}
