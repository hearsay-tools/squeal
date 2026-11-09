// Throwaway probe for research/mutation-planning.md (row 015-125), question 1: the table at one revision.
// Joins compare.json (rows), related-now.json (Vitest related at the scratch copy's revision) and index.json
// (Squeal's newest records), for the files that still exist at that revision.
// usage: node q1.mjs <compare.json> <related-in.json> <related-now.json> <index.json> <scratch cezar> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [cmpF, inF, nowF, idxF, repo, out] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(cmpF, "utf8"));
const sets = JSON.parse(readFileSync(inF, "utf8"));
const now = JSON.parse(readFileSync(nowF, "utf8"));
const { index } = JSON.parse(readFileSync(idxF, "utf8"));
const PROJECT = { cezar: "server", web: "web", contract: "contract", "api-client": "api-client" };
const blob = (p) => { try { return execFileSync("git", ["-C", repo, "rev-parse", `HEAD:${p}`], { encoding: "utf8" }).trim(); } catch { return null; } };
const CAP = 150;
const table = [];
for (const s of sets) {
  const row = rows[s.id];
  const related = new Set(now[s.id]);
  const called = new Set(), loaded = new Set();
  let blobOk = 0;
  for (const f of s.files) {
    const b = blob(f);
    const e = (index[f] ?? []).filter((x) => x.project === PROJECT[s.pkg]);
    if (e.length && e.every((x) => x.blob === b)) blobOk++;
    for (const x of e) { loaded.add(x.test); if (x.called) called.add(x.test); }
  }
  const only = (a, b) => [...a].filter((x) => !b.has(x));
  table.push({
    branch: row.branch, pkg: s.pkg, state: row.state, files: s.files.length, blobOk,
    relatedThen: row.related, relatedNow: related.size, dryRun: row.dryRun ?? null, covering: row.covering ?? null,
    loaded: loaded.size, called: called.size, loadedOnly: loaded.size - called.size,
    calledNotRelated: only(called, related).length, relatedNotLoaded: only(related, loaded).length,
    calledNotRelatedExamples: only(called, related).slice(0, 3),
    capThen: row.related > CAP, capRelatedNow: related.size > CAP, capCalled: called.size > CAP,
    capCalledAndRelated: [...called].filter((x) => related.has(x)).length > CAP,
  });
}
writeFileSync(out, JSON.stringify(table, null, 1));
console.log("branch\tpkg\tstate\tfiles\tblobOk\trelThen\trelNow\tdryRun\tcovering\tloaded\tcalled\tloadOnly\tcalled-not-related\trelated-not-loaded");
for (const t of table) console.log([t.branch.slice(0, 28), t.pkg, t.state, t.files, t.blobOk, t.relatedThen, t.relatedNow, t.dryRun ?? "-", t.covering ?? "-", t.loaded, t.called, t.loadedOnly, t.calledNotRelated, t.relatedNotLoaded].join("\t"));
