// Throwaway (row 018-72). The parent coordinator's pull-rerun rule (ffload-commits.cjs, rule A,
// copied, not edited in place), and for each file-run with no CI match on a commit whose export
// was imported: why. Read-only: squawk's store (readOnly + query_only), git in its clone.
// Usage: node week.cjs <store.sqlite> <repo> <days>
const { DatabaseSync } = require("node:sqlite");
const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const [file, repo, daysArg] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
db.exec("PRAGMA query_only = 1");
const runsDir = path.join(path.dirname(file), "runs");
const now = Number(process.env.NOW ?? Date.now()), since = now - Number(daysArg ?? 7) * 86400000;
const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const bases = new Map();
const startOf = (h) => { if (!bases.has(h)) bases.set(h, git("merge-base", h, "origin/main")); return bases.get(h); };
const anc = new Map();
const isAnc = (a, b) => { const k = a + b; if (!anc.has(k)) anc.set(k, git("merge-base", "--is-ancestor", a, b) !== null); return anc.get(k); };
const runs = db.prepare("select id, worktree_id w, revision, test_files tf, started_at s, ended_at e from runs order by w, started_at").all();
const headQ = db.prepare("select commit_sha c, max(dirty) d from results where run_id = ? group by commit_sha");
const keysQ = db.prepare("select distinct c.project p, c.test_path f, r.key k from results r join checks c on c.id = r.check_id where r.run_id = ?");
const revHead = new Map();
for (const r of runs) {
  const k = r.w + ":" + r.revision;
  if (revHead.has(k)) continue;
  const rows = headQ.all(r.id);
  if (rows.length === 1 && rows[0].c) revHead.set(k, { c: rows[0].c, d: rows[0].d });
  else if (rows.length > 1) revHead.set(k, { c: rows[0].c, d: 1, mixed: true });
}
// Imports by commit; each import's files with key, environment and whether that environment is CI's.
const ciEnv = new Map(db.prepare("select hash, json_extract(descriptor, '$.ci') ci from environments").all().map((r) => [r.hash, r.ci === 1]));
const importsOf = new Map();
for (const r of db.prepare("select id, json_extract(header,'$.commit') c, json_extract(header,'$.squealVersion') v, imported_at at from imports").all()) {
  if (!importsOf.has(r.c)) importsOf.set(r.c, []);
  importsOf.get(r.c).push(r);
}
const filesQ = db.prepare("select project p, path f, key k, environment e from import_files where import_id = ?");
const importFiles = new Map();
const filesOf = (id) => { if (!importFiles.has(id)) { const m = new Map(); for (const r of filesQ.iterate(id)) { const k = r.p + "\0" + r.f; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } importFiles.set(id, m); } return importFiles.get(id); };
const robust = /ui-mapper-robustness/;
const anyImport = new Set(); for (const r of db.prepare("select project p, path f, key k from import_files").iterate()) anyImport.add(r.p + "\0" + r.f + "\0" + r.k);
const out = { window: [new Date(since).toISOString(), new Date(now).toISOString()], pullFileSec: 0, byClass: {}, byProjectClass: {}, ciKeyKeptByFile: {}, rekeyedDiffersByFile: {}, absentByVersion: {}, perDayClass: {}, rekeyedEvents: {}, samples: {}, absentByFile: {} };
const add = (o, k, v) => { o[k] = (o[k] ?? 0) + v; };
let lastW = null, lastStart = null, pullTo = null;
for (const run of runs) {
  if (run.w !== lastW) { lastW = run.w; lastStart = null; pullTo = null; }
  const h = revHead.get(run.w + ":" + run.revision);
  if (h && h.c) {
    const st = startOf(h.c);
    const onMain = st === h.c && !h.d;
    if (onMain && lastStart && st !== lastStart && isAnc(lastStart, st)) pullTo = st;
    else if (!(onMain && pullTo === st)) pullTo = null;
    if (st) lastStart = st;
  }
  if (run.s < since || run.s >= now || pullTo === null) continue;
  const files = JSON.parse(run.tf);
  const wall = run.e ? (run.e - run.s) / 1000 : 0;
  let durs = null;
  try { durs = new Map(JSON.parse(readFileSync(path.join(runsDir, run.id, "report.json"), "utf8")).report.fileDurations.map((d) => [d.testFile.project + "\0" + d.testFile.path, d.durationMs / 1000])); } catch {}
  const secOf = (f) => durs?.get(f.project + "\0" + f.path) ?? wall / Math.max(1, files.length);
  const keys = new Map(); for (const r of keysQ.all(run.id)) { const k = r.p + "\0" + r.f; if (!keys.has(k)) keys.set(k, []); keys.get(k).push(r.k); }
  const imps = importsOf.get(h.c) ?? [];
  const day = new Date(run.s).toISOString().slice(0, 10);
  for (const f of files) {
    const fk = f.project + "\0" + f.path; const ks = keys.get(fk) ?? []; const sec = secOf(f);
    out.pullFileSec += sec;
    let cls;
    if (imps.length === 0) cls = "headNeverImported";
    else if (ks.length === 0) cls = "noStoredKey";
    else {
      const rows = imps.flatMap((i) => (filesOf(i.id).get(fk) ?? []).map((r) => ({ ...r, v: i.v, at: i.at })));
      const ver = imps.map((i) => i.v).sort().at(-1);
      if (ks.some((k) => anyImport.has(fk + "\0" + k))) cls = "ciMatch";
      else if (rows.length === 0) { cls = "absentFromExport@" + ver; add(out.absentByFile, f.project + " " + f.path, sec); add(out.absentByVersion, imps.map((i) => i.v).sort().join("+"), sec); }
      else if (rows.every((r) => ciEnv.get(r.e) === true)) { cls = (robust.test(f.path) ? "ciKeyKept:robustness" : "ciKeyKept:other") + "@" + ver; add(out.ciKeyKeptByFile, f.path, sec); }
      else { cls = "rekeyedKeyDiffers@" + ver; add(out.rekeyedDiffersByFile, f.path, sec);
        const ev = `${run.w} ${h.c.slice(0, 8)} ${rows.map((r) => r.e.slice(0, 10)).filter((x, i, a) => a.indexOf(x) === i).join(",")}`; add(out.rekeyedEvents, ev, sec);
        if (process.env.SAMPLE) (out.samples[ev] ??= []).length < 400 && out.samples[ev].push({ run: run.id, path: f.path, project: f.project, keys: ks, importKeys: rows.map((r) => [r.k, r.e]) }); }
    }
    add(out.byClass, cls, sec); add(out.byProjectClass, f.project + " " + cls, sec);
    out.perDayClass[day] ??= {}; add(out.perDayClass[day], cls, sec);
  }
}
const r1 = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "number" ? Math.round(v) : v)));
const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
out.absentFiles = Object.keys(out.absentByFile).length; out.ciKeyKeptByFile = top(out.ciKeyKeptByFile, 40); out.rekeyedDiffersByFile = top(out.rekeyedDiffersByFile, 40);
console.log(JSON.stringify(r1(out), null, 1));
