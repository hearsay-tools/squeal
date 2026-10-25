// Throwaway probe (016-27), question 5 (R3): for each directory classify.mjs found mixed in some worktree,
// each reader's current known states inherited from another worktree classify.mjs read, and whether the
// directory's ignored names (what keying them would add) differ between the two worktrees today.
// Read-only. Usage: mixed-inherited.mjs <store> <classify.jsonl> <listings.jsonl>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [file, classified, listingsFile] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const rows = readFileSync(classified, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const readers = new Map(readFileSync(listingsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((o) => [`${o.project}\0${o.dir}`, o.readers]));
const ignoredNames = (r) => (r.state === "mixed" ? r.hash : "none");
const state = new Map(rows.map((r) => [`${r.worktree}\0${r.project}\0${r.dir}`, r]));
const mixedDirs = new Set(rows.filter((r) => r.state === "mixed").map((r) => `${r.project}\0${r.dir}`));
const q = db.prepare("select k.origin_worktree ow, k.validity v, count(*) n from known_states k join checks c on c.id = k.check_id where k.worktree_id = ? and c.project = ? and c.test_path = ? and k.origin_kind = 'inherited' group by 1, 2");
const totals = { inheritedPairs: 0, originRead: 0, namesDiffer: 0 };
for (const r of rows) {
  if (!mixedDirs.has(`${r.project}\0${r.dir}`)) continue;
  for (const test of readers.get(`${r.project}\0${r.dir}`) ?? []) for (const s of q.all(r.worktree, r.project, test)) {
    totals.inheritedPairs++;
    const o = state.get(`${s.ow}\0${r.project}\0${r.dir}`);
    if (o === undefined) continue;
    totals.originRead++;
    if (ignoredNames(o) === ignoredNames(r)) continue;
    totals.namesDiffer++;
    console.log(JSON.stringify({ worktree: r.worktree.slice(0, 8), origin: s.ow.slice(0, 8), dir: r.dir, test, here: r.state === "mixed" ? r.unseenSample : [], there: o.state === "mixed" ? o.unseenSample : [], validity: s.v, checks: s.n }));
  }
}
console.log(JSON.stringify({ totals }));
