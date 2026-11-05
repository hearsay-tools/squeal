// 011-298 probe (throwaway): the miss cause of each restart-baseline file run, from classify.cjs output and the store copy.
// Usage: node causes.cjs <store copy> <classify output.jsonl>
// Order: (1) the predecessor listed the file at its own start and never stored it; (2) the predecessor stored it, then
// its key moved; (3) the predecessor found it current at start, never ran it, and its key moved. (2) and (3) split by
// what moved between that point and the restart: the commit, other revisions at the same commit, or nothing local.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const L = fs.readFileSync(process.argv[3], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cks = db.prepare("select id, worktree_id, revision, test_files, started_at from checkpoints where kind = 'baseline' order by started_at").all();
const prevOf = new Map(), last = new Map(), byId = new Map();
for (const c of cks) { c.set = new Set(JSON.parse(c.test_files).map((f) => f.project + "\0" + f.path)); prevOf.set(c.id, last.get(c.worktree_id) ?? null); last.set(c.worktree_id, c); byId.set(c.id, c); }
const runRev = db.prepare("select revision from runs where id = ?");
const maxRev = db.prepare("select max(revision) m from runs where worktree_id = ? and started_at < ?"); const mc = new Map();
const revs = new Map(); for (const r of db.prepare("select worktree_id w, number, trigger from revisions").all()) (revs.get(r.w) ?? revs.set(r.w, []).get(r.w)).push(r);
const S = new Map(); let tot = 0, totN = 0; const per = [];
const add = (k, x) => { const v = S.get(k) ?? { n: 0, sec: 0, b: new Set() }; v.n++; v.sec += x.sec; v.b.add(x.ck); S.set(k, v); };
for (const x of L) {
  if (!x.ran) continue; tot += x.sec; totN++;
  const c = byId.get(x.ck), p = prevOf.get(x.ck);
  let m = mc.get(x.ck); if (m === undefined) { m = maxRev.get(x.W, x.T).m ?? -1; mc.set(x.ck, m); }
  const pr = x.prior;
  const ownInPrev = pr && pr.inPrev && pr.completed && pr.keys.length > 0;
  const triedInPrev = pr && pr.inPrev;
  let cause, from = null;
  if (p.set.has(x.file) && !ownInPrev) cause = "1 predecessor listed it at start and stored nothing" + (triedInPrev ? " (its run did not finish)" : " (never started it)");
  else if (pr && pr.completed && pr.keys.length === 0) cause = "4 own result gone (replaced or discarded)";
  else {
    const base = ownInPrev ? "2 predecessor stored it, then the key moved" : "3 predecessor found it current, never ran it, key moved";
    from = ownInPrev ? runRev.get(pr.run).revision : p.revision;
    const commit = x.prevCommit === null || x.newCommit === null ? "?" : (ownInPrev ? pr.commit : x.prevCommit.sha) === x.newCommit ? "same" : "moved";
    const what = c.revision === from ? "no local revision since" : commit === "moved" ? "commit moved" : commit === "same" ? "same commit, later revisions" : "later revisions, commit unknown";
    cause = base + ": " + what;
    const R = revs.get(x.W);
    if (R && c.revision !== from) { const t = [...new Set(R.filter((r) => r.number > from && r.number <= c.revision).map((r) => r.trigger))].sort().join("+"); add("  surviving worktrees: " + cause.slice(0, 1) + " revisions by " + t, x); }
  }
  add(cause, x);
  per.push({ cause: cause.includes("no local revision") ? cause.slice(0, 1) + "-nolocal" : cause.slice(0, 1), project: x.file.split("\0")[0], sec: x.sec, W: x.W });
}
console.log(`ran ${totN} file runs, ${Math.round(tot)} recorded s`);
for (const [k, v] of [...S].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(`${(100 * v.sec / tot).toFixed(1).padStart(5)}% ${String(Math.round(v.sec)).padStart(7)} s ${String(v.n).padStart(6)} files ${String(v.b.size).padStart(4)} baselines  ${k}`);
const byP = {}; for (const r of per) { const k = r.cause + " " + r.project; byP[k] = (byP[k] ?? 0) + r.sec; }
console.log(Object.entries(byP).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${Math.round(v)}`).join("\n"));
// Merged classes as the report's table gives them: union of baselines, and seconds by project.
const merged = (k) => k.startsWith("1 ") ? "1" : k.includes("no local revision") ? "nolocal" : k.includes("commit moved") ? "commit" : k.includes("same commit") ? "samecommit" : k.includes("commit unknown") ? "unknown" : k.startsWith("4 ") ? "gone" : null;
const M = {};
for (const [k, v] of S) { const m = merged(k); if (!m) continue; M[m] ??= { sec: 0, n: 0, b: new Set() }; M[m].sec += v.sec; M[m].n += v.n; for (const b of v.b) M[m].b.add(b); }
console.log(Object.entries(M).map(([k, v]) => `${k}: ${Math.round(v.sec)} s, ${v.n} files, ${v.b.size} baselines`).join("\n"));
const proj = {}; for (const r of per) proj[r.project] = (proj[r.project] ?? 0) + r.sec;
console.log(Object.entries(proj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)} (${(100 * v / tot).toFixed(1)}%)`).join(", "));
