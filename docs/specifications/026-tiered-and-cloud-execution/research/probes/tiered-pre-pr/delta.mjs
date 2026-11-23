// Throwaway (026, tiered-pre-pr). For the last N main commits that have a CI
// import in a store copy, compares each import's file keys with the import of
// the commit before it. A file whose key is equal is settled by the earlier
// import (the pre-PR case: a branch whose head has this commit's content and
// whose base has the earlier export). A file whose key changed, or that the
// earlier export lacks, must run before the PR. Durations: the median local
// file time per (project, path) from report.json over the window.
// Usage: node delta.mjs <store copy> <runs dir> <repo> <N> <from ISO>
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [store, runsDir, repo, nArg, fromIso] = process.argv.slice(2);
const N = Number(nArg);
const db = new DatabaseSync(store, { readOnly: true });
const imports = db.prepare(
  "select id, json_extract(header, '$.commit') c, imported_at t from imports order by imported_at",
).all();
const byCommit = new Map();
for (const i of imports) byCommit.set(i.c, i); // newest import of each commit wins
const commits = [...byCommit.values()].sort((a, b) => a.t - b.t).slice(-(N + 1));
const filesOf = db.prepare("select project, path, key, environment from import_files where import_id = ?");

// Median local duration per file.
const runs = db.prepare("select id from runs where started_at >= ?").all(Date.parse(fromIso));
const durs = new Map();
for (const r of runs) {
  let rep;
  try { rep = JSON.parse(readFileSync(join(runsDir, r.id, "report.json"), "utf8")).report; } catch { continue; }
  for (const f of rep.fileDurations ?? []) {
    const k = `${f.testFile.project}\0${f.testFile.path}`;
    (durs.get(k) ?? durs.set(k, []).get(k)).push(f.durationMs / 1000);
  }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const med = new Map([...durs].map(([k, v]) => [k, median(v)]));

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
console.log("commit\tparent_is_prev\tchanged_paths\texported\tsettled\tchanged_key\tnew\tenv_changed_projects\tmust_run_file_s\tmust_run_unknown\tfull_file_s\tfull_unknown");
const totals = [];
for (let i = 1; i < commits.length; i++) {
  const prev = commits[i - 1], cur = commits[i];
  const P = new Map(filesOf.all(prev.id).map((f) => [`${f.project}\0${f.path}`, f]));
  const C = filesOf.all(cur.id);
  const envChanged = new Set();
  let settled = 0, changed = 0, fresh = 0, mustS = 0, mustU = 0, fullS = 0, fullU = 0;
  for (const f of C) {
    const k = `${f.project}\0${f.path}`;
    const d = med.get(k);
    if (d === undefined) fullU++; else fullS += d;
    const p = P.get(k);
    if (p && p.key === f.key) { settled++; continue; }
    if (p) { changed++; if (p.environment !== f.environment) envChanged.add(f.project); } else fresh++;
    if (d === undefined) mustU++; else mustS += d;
  }
  let parentIsPrev = "?", paths = "?";
  try {
    parentIsPrev = git("rev-parse", `${cur.c}^`) === prev.c ? "yes" : "no";
    paths = git("diff", "--name-only", prev.c, cur.c).split("\n").filter(Boolean).length;
  } catch { /* commit not in this clone */ }
  totals.push({ settled, changed, fresh, mustS, fullS, n: C.length });
  console.log([cur.c.slice(0, 9), parentIsPrev, paths, C.length, settled, changed, fresh, [...envChanged].join(",") || "-", mustS.toFixed(0), mustU, fullS.toFixed(0), fullU].join("\t"));
}
const ms = totals.map((t) => t.changed + t.fresh).sort((a, b) => a - b);
const mss = totals.map((t) => t.mustS).sort((a, b) => a - b);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
console.log(`pairs ${totals.length}; must-run files p50 ${q(ms, 0.5)}, p75 ${q(ms, 0.75)}, p90 ${q(ms, 0.9)}, max ${ms[ms.length - 1]}`);
console.log(`must-run file-s p50 ${q(mss, 0.5).toFixed(0)}, p75 ${q(mss, 0.75).toFixed(0)}, p90 ${q(mss, 0.9).toFixed(0)}, max ${mss[mss.length - 1].toFixed(0)}; full suite file-s p50 ${q(totals.map((t) => t.fullS).sort((a, b) => a - b), 0.5).toFixed(0)}`);
console.log(`files with a local median: ${med.size}`);
