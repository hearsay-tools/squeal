// Throwaway probe (016-27), question 4: for each worktree classify.mjs read, each test file that lists a
// directory in a state other than `watched` there, the origin of its current known states. An inherited
// state is compared with the listed directory's state and names hash in the origin worktree, when
// classify.mjs read that worktree too. A pair whose names differ is the blocker the brief names.
// Read-only. Usage: inherited.mjs <store> <classify.jsonl> <listings.jsonl>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [file, classified, listingsFile] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const rows = readFileSync(classified, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const readers = new Map(readFileSync(listingsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((o) => [`${o.project}\0${o.dir}`, o.readers]));
const state = new Map(rows.map((r) => [`${r.worktree}\0${r.project}\0${r.dir}`, r]));
const q = db.prepare("select k.origin_kind o, k.origin_worktree ow, k.validity v, count(*) n from known_states k join checks c on c.id = k.check_id where k.worktree_id = ? and c.project = ? and c.test_path = ? group by 1, 2, 3");
const totals = { readerPairs: 0, inherited: 0, comparedOrigins: 0, namesDiffer: 0, existenceDiffers: 0, originNotRead: 0 };
for (const r of rows) {
  if (r.state === "watched") continue;
  for (const test of readers.get(`${r.project}\0${r.dir}`) ?? []) {
    totals.readerPairs++;
    for (const s of q.all(r.worktree, r.project, test)) {
      if (s.o !== "inherited") continue;
      totals.inherited++;
      const o = state.get(`${s.ow}\0${r.project}\0${r.dir}`);
      let verdict = "origin not read";
      if (o === undefined) totals.originNotRead++;
      else {
        totals.comparedOrigins++;
        const here = r.state === "mixed" ? null : r.hash, there = o.state === "mixed" ? null : o.hash;
        if (o.state === "unwatched" || r.state === "unwatched") verdict = here === there ? "same names" : "NAMES DIFFER";
        else verdict = r.state === o.state ? "same state" : `${r.state} here, ${o.state} there`;
        if (verdict === "NAMES DIFFER") totals.namesDiffer++;
        else if (verdict.includes("there")) totals.existenceDiffers++;
      }
      console.log(JSON.stringify({ worktree: r.worktree.slice(0, 8), dir: r.dir, state: r.state, test, origin: s.ow?.slice(0, 8), validity: s.v, checks: s.n, verdict }));
    }
  }
}
console.log(JSON.stringify({ totals }));
