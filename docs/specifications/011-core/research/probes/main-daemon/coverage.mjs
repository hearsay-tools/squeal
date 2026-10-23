// 011-157 probe (throwaway), question 1: for each linked worktree's first daemon start in the window, the share of its files and their
// seconds whose closure content equals the main checkout's content at that time (its HEAD), had a daemon there run it.
// Usage: node coverage.mjs <store copy> <repo root> <copy ms> <out.jsonl> [hours=72]
// Reads the store copy, and the repository's git objects and reflogs read only (git ls-tree, merge-base --is-ancestor, cat-file).
import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs"; import { execFileSync } from "node:child_process";
import { makeSig } from "./sig.mjs";
const [, , storePath, root, copyArg, outPath, hoursArg] = process.argv;
const copyAt = Number(copyArg), since = copyAt - Number(hoursArg ?? 72) * 3600_000, gitDir = root + "/.git";
const db = new DatabaseSync(storePath, { readOnly: true });
const { sig, tree } = makeSig(db, gitDir, root + "/squeal.config.json");
const git = (...a) => execFileSync("git", ["--git-dir", gitDir, ...a], { maxBuffer: 1 << 26 }).toString().trim();
const reflog = (f) => { if (!existsSync(f)) return []; return readFileSync(f, "utf8").trim().split("\n").map((l) => { const m = l.split("\t")[0].match(/^(\w+) (\w+) .*> (\d+) [+-]\d+$/); return m && { at: Number(m[3]) * 1000, from: m[1], to: m[2], msg: l.split("\t")[1] ?? "" }; }).filter(Boolean); };
const atTime = (log, t) => { let v = null; for (const e of log) { if (e.at <= t) v = e.to; else { if (v === null) v = e.from; break; } } return v; };
const mainLog = reflog(gitDir + "/logs/HEAD"), originLog = reflog(gitDir + "/logs/refs/remotes/origin/main");
const cand = new Set();
function walk(d) { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const p = d + "/" + n; if (statSync(p).isDirectory()) walk(p); else for (const e of reflog(p)) cand.add(e.to); } }
for (const d of ["logs/refs/remotes/origin/cand", "logs/refs/heads/cand"]) walk(gitDir + "/" + d);
for (const l of git("for-each-ref", "--format=%(objectname)", "refs/heads/cand", "refs/remotes/origin/cand").split("\n")) if (l) cand.add(l);
const anc = new Map(); const isAnc = (a, b) => { const k = a + b; if (!anc.has(k)) { try { execFileSync("git", ["--git-dir", gitDir, "merge-base", "--is-ancestor", a, b]); anc.set(k, true); } catch { anc.set(k, false); } } return anc.get(k); };
const main = db.prepare("SELECT id FROM worktrees WHERE is_main = 1").get().id;
const live = new Map(db.prepare("SELECT id, root, registered_at FROM worktrees").all().map((w) => [w.id, w]));
// Median recorded seconds of each file check: the per-file duration a run of it stores.
const usual = new Map();
for (const c of db.prepare("SELECT c.project, c.test_path, group_concat(r.duration_ms) d FROM checks c JOIN results r ON r.check_id = c.id WHERE c.kind = 'file' GROUP BY c.id").all()) { const d = c.d.split(",").map(Number).sort((a, b) => a - b); usual.set(c.project + "\0" + c.test_path, d[d.length >> 1] / 1000); }
let exclude = []; try { exclude = (JSON.parse(readFileSync(root + "/squeal.config.json", "utf8")).vitest?.exclude ?? []).map((g) => new RegExp("^" + g.replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*"))); } catch {}
const allFiles = db.prepare("SELECT project, path FROM test_files").all().map((t) => t.project + "\0" + t.path).filter((f) => !exclude.some((re) => re.test(f.split("\0")[1])));
const starts = [];
for (const [id, w] of live) {
  if (id === main) continue;
  const r = db.prepare("SELECT number, head, dirty, created_at FROM revisions WHERE worktree_id = ? AND head IS NOT NULL ORDER BY number LIMIT 1").get(id);
  if (!r || r.number > 1 || r.created_at < since) continue;
  const files = db.prepare("SELECT project || char(0) || path f FROM test_file_keys WHERE worktree_id = ?").all(id).map((x) => x.f);
  starts.push({ w: id, live: true, root: w.root, t: r.created_at, W: r.head, dirty: r.dirty, files });
}
const seen = new Set(starts.map((s) => s.w));
for (const c of db.prepare("SELECT worktree_id w, revision, started_at FROM checkpoints WHERE kind = 'baseline' ORDER BY started_at").all()) {
  if (seen.has(c.w)) continue; seen.add(c.w);
  if (live.has(c.w) || c.started_at < since || c.revision > 1) continue;
  const row = db.prepare("SELECT commit_sha, dirty FROM results WHERE worktree_id = ? AND revision <= ? AND commit_sha IS NOT NULL LIMIT 1").get(c.w, c.revision);
  starts.push({ w: c.w, live: false, root: null, t: c.started_at, W: row?.commit_sha ?? null, dirty: row?.dirty ?? null, files: null });
}
const out = [];
for (const s of starts.sort((a, b) => a.t - b.t)) {
  const M = atTime(mainLog, s.t), O = atTime(originLog, s.t);
  const mainMovedAt = [...mainLog].reverse().find((e) => e.at <= s.t)?.at ?? null;
  let where = "commit unknown";
  if (s.W) where = s.W === M ? "main HEAD" : (O && (s.W === O || (isAnc(M, s.W) && isAnc(s.W, O)))) ? "origin ahead of main" : cand.has(s.W) ? "candidate" : isAnc(s.W, M) ? "behind main HEAD" : "another branch";
  const tW = s.W && tree(s.W);
  const files = s.files ?? (tW ? allFiles.filter((f) => tW.has(f.split("\0")[1])) : []);
  // Main heads in the 7 days before the start (results' retention): content any of them had counts as "earlier main content".
  const heads = [...new Set(mainLog.filter((e) => e.at <= s.t && e.at >= s.t - 7 * 86400_000).map((e) => e.to).concat(M ? [M] : []))];
  let n = 0, eqNow = 0, eqEver = 0, secs = 0, sNow = 0, sEver = 0, unknownSecs = 0, eqOrigin = 0, sOrigin = 0, mN = 0, mSecs = 0, mEq = 0, mEqSecs = 0, mO = 0, mOSecs = 0;
  // The start's misses today: its first baseline checkpoint's test files (what it found in no stored result).
  const ck = db.prepare("SELECT test_files FROM checkpoints WHERE worktree_id = ? AND kind = 'baseline' ORDER BY started_at LIMIT 1").get(s.w);
  const missSet = new Set(ck ? JSON.parse(ck.test_files).map((f) => f.project + "\0" + f.path) : []);
  if (tW) for (const f of files) {
    const sec = usual.get(f) ?? 0; if (!usual.has(f)) unknownSecs++;
    n++; secs += sec; const missed = missSet.has(f); if (missed) { mN++; mSecs += sec; }
    const a = sig(f, s.W); if (a === null) continue;
    if (missed && M && sig(f, M) === a) { mEq++; mEqSecs += sec; }
    // The counterfactual: a main checkout that had followed origin/main (the local remote-tracking ref at the start).
    if (O && sig(f, O) === a) { eqOrigin++; sOrigin += sec; if (missed) { mO++; mOSecs += sec; } }
    if (M && sig(f, M) === a) { eqNow++; sNow += sec; eqEver++; sEver += sec; continue; }
    if (heads.some((h) => sig(f, h) === a)) { eqEver++; sEver += sec; }
  }
  const o = { w: s.w, live: s.live, root: s.root?.split("/").pop() ?? null, t: s.t, iso: new Date(s.t).toISOString(), W: s.W, dirty: s.dirty, M, O, where, lagMin: mainMovedAt ? Math.round((s.t - mainMovedAt) / 60000) : null,
    n, eqNow, eqEver, eqOrigin, secs: Math.round(secs), sNow: Math.round(sNow), sEver: Math.round(sEver), sOrigin: Math.round(sOrigin), mN, mSecs: Math.round(mSecs), mEq, mEqSecs: Math.round(mEqSecs), mO, mOSecs: Math.round(mOSecs), noDuration: unknownSecs };
  out.push(o); console.error(JSON.stringify(o));
}
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const by = {}; for (const o of out) { const k = o.where; by[k] ??= { starts: 0, n: 0, eqNow: 0, eqEver: 0, eqOrigin: 0, secs: 0, sNow: 0, sEver: 0, sOrigin: 0, mN: 0, mSecs: 0, mEq: 0, mEqSecs: 0, mO: 0, mOSecs: 0 }; const b = by[k]; b.starts++; for (const x of Object.keys(b)) if (x !== "starts") b[x] += o[x]; }
const tot = { starts: 0, n: 0, eqNow: 0, eqEver: 0, eqOrigin: 0, secs: 0, sNow: 0, sEver: 0, sOrigin: 0, mN: 0, mSecs: 0, mEq: 0, mEqSecs: 0, mO: 0, mOSecs: 0 }; for (const b of Object.values(by)) for (const x in tot) tot[x] += b[x]; by.all = tot;
for (const [k, b] of Object.entries(by)) console.log(`${k}: ${b.starts} starts, ${b.n} files; equal to main HEAD ${b.eqNow} (${(100 * b.eqNow / b.n).toFixed(1)}%), ${b.sNow} of ${b.secs} s (${(100 * b.sNow / b.secs).toFixed(1)}%); equal to some main HEAD of the 7 days ${b.eqEver} (${(100 * b.eqEver / b.n).toFixed(1)}%), ${b.sEver} s (${(100 * b.sEver / b.secs).toFixed(1)}%); equal to origin/main then ${b.eqOrigin} (${(100 * b.eqOrigin / b.n).toFixed(1)}%), ${b.sOrigin} s (${(100 * b.sOrigin / b.secs).toFixed(1)}%); misses today ${b.mN} files, ${b.mSecs} s, of them equal to main HEAD ${b.mEq} files, ${b.mEqSecs} s (${(100 * b.mEqSecs / b.mSecs).toFixed(1)}%), equal to origin/main then ${b.mO} files, ${b.mOSecs} s (${(100 * b.mOSecs / b.mSecs).toFixed(1)}%)`);
