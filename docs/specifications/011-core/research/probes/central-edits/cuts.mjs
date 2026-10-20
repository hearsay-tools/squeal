// THROWAWAY probe (011-core/research/central-edits.md, question 2). Over every agent revision of
// cezar's store (no HEAD move, 1 to 9 keyed sources; results/direct-all.json.gz from
// `R25_ALL=1 node direct.mjs`), by how many fast test files it re-keyed: how many stay edits and how
// many become catch-up under each cut, and where the revision's own test files land.
//   (a)  edited + direct stay edits;
//   (b)  (a) only above N re-keyed files (N = 12, cezar's tierSize; 24; 50);
//   (c)  edited + direct + depth 2 stay edits.
// Files absent at the head are left out (they did not exist then); "outside" files (a declared
// input, a path a run read, or a module no file imported yet) are catch-up under (a) and (c).
import { writeFileSync } from "node:fs";
import { readResult } from "./graph.mjs";

const revs = readResult("direct-all");
const BINS = [[1, 4], [5, 12], [13, 24], [25, 49], [50, 99], [100, 199], [200, Infinity]];
const isEdit = { a: (f) => f.cls === "edited" || f.cls === "direct", c: (f) => f.depth !== null && f.depth <= 2 };
const rows = [];
for (const [lo, hi] of BINS) {
  const rs = revs.map((r) => ({ ...r, fs: r.files.filter((f) => f.cls !== "absent") })).filter((r) => r.fs.length >= lo && r.fs.length <= hi);
  if (!rs.length) continue;
  const sum = (f) => rs.reduce((a, r) => a + f(r), 0);
  const owns = rs.flatMap((r) => r.own.map((o) => o.cls));
  rows.push({
    "re-keyed": hi === Infinity ? `${lo}+` : `${lo}-${hi}`, revisions: rs.length, files: sum((r) => r.fs.length),
    "edit under (a)": sum((r) => r.fs.filter(isEdit.a).length), "catch-up under (a)": sum((r) => r.fs.filter((f) => !isEdit.a(f)).length),
    "of which outside": sum((r) => r.fs.filter((f) => f.cls === "outside").length),
    "edit under (c)": sum((r) => r.fs.filter(isEdit.c).length),
    "own: edited/direct/transitive/outside/absent": ["edited", "direct", "transitive", "outside", "absent"].map((c) => owns.filter((o) => o === c).length).join("/"),
  });
}
console.table(rows);
// The own files that would leave the edit route under (a): which, and why.
const lost = revs.flatMap((r) => r.own.filter((o) => o.cls !== "edited" && o.cls !== "direct").map((o) => `${r.rev} (${r.files.length} re-keyed): ${o.id} is ${o.cls}`));
console.log(`own test files off the edit route under (a): ${lost.length}`);
for (const l of lost) console.log(`  ${l}`);
writeFileSync(new URL("results/cuts.json", import.meta.url), JSON.stringify({ rows, lost }, null, 1));
