// 011-148 probe (throwaway): replay catch-up of edits under later starts (a quiet of Q s, or the agent's turn end).
// Usage: node catchup.mjs <store copy> <fate.jsonl> <turns.json> <class prefix, e.g. catchup-edit>
// Model: a recorded catch-up file run at s moves to g(s), the first time at or after s with Q s since the
// worktree's last watch revision (or, for "turn", the first turn end after s when the worktree had an edit
// since its last turn end). Runs of one file that move to the same g collapse to one run, at the usual
// duration of the file; a run whose file a later revision re-keyed before g is not needed.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, fatePath, turnsPath, clsPrefix = "catchup-edit"] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const fate = readFileSync(fatePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const turnsByRoot = JSON.parse(readFileSync(turnsPath, "utf8"));
const rootOf = new Map(db.prepare("SELECT id, root FROM worktrees").all().map((w) => [w.id, w.root]));
const closures = new Map();
for (const t of db.prepare("SELECT project, path, closure_paths FROM test_files").all()) closures.set(t.project + "\0" + t.path, new Set(JSON.parse(t.closure_paths)));
const revs = new Map();
for (const r of db.prepare("SELECT worktree_id, number, created_at, trigger, changes FROM revisions WHERE trigger = 'watch' ORDER BY worktree_id, created_at").all()) {
  r.paths = JSON.parse(r.changes).map((c) => c.path);
  (revs.get(r.worktree_id) ?? revs.set(r.worktree_id, []).get(r.worktree_id)).push(r);
}
const touches = (r, k) => { const p = k.split("\0")[1]; const c = closures.get(k); return r.paths.some((x) => x === p || c?.has(x)); };
const usual = new Map();
for (const r of db.prepare("SELECT c.project p, c.test_path t, r.duration_ms d FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.duration_ms > 0").all()) { const k = r.p + "\0" + r.t; (usual.get(k) ?? usual.set(k, []).get(k)).push(r.d / 1000); }
const med = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// to-FAIL transitions caused by a run: same worktree and test file, within the run or 15 s after it
const trans = db.prepare(`SELECT c.project p, c.test_path t, tr.at, tr.from_outcome f, tr.to_outcome o FROM transitions tr JOIN checks c ON c.id = tr.check_id WHERE tr.worktree_id = ? AND tr.at >= ? AND tr.at <= ?`);
const rows = fate.filter((f) => f.cls.startsWith(clsPrefix) && f.live && revs.has(f.w));
const dataEnd = Math.max(...fate.map((f) => f.endAt));
for (const f of rows) f.toFail = trans.all(f.w, f.start, f.endAt + 15_000).some((t) => t.p + "\0" + t.t === f.file && t.o === "fail" && t.f !== "fail");
function gQuiet(w, s, q) {
  const list = revs.get(w); let g = s;
  for (;;) { let last = null; for (const r of list) { if (r.created_at > g) break; last = r.created_at; } if (last === null || g - last >= q) return g; g = last + q; }
}
function gTurn(w, s) {
  const turns = turnsByRoot[rootOf.get(w)] ?? [];
  if (!turns.length) return undefined;
  const list = revs.get(w);
  let lastRev = null; for (const r of list) { if (r.created_at > s) break; lastRev = r.created_at; }
  let lastTurn = null; for (const t of turns) { if (t > s) break; lastTurn = t; }
  if (lastRev === null || (lastTurn !== null && lastTurn >= lastRev)) return s;
  const next = turns.find((t) => t >= s);
  return next ?? null; // null: no turn end seen after s
}
function replay(name, g) {
  let recorded = 0, kept = 0, moot = 0, noEnd = 0, covered = 0, cutToday = 0, cutStill = 0; const groups = new Map(); const delays = []; let failsMoot = 0, failsNoEnd = 0;
  for (const f of rows) {
    recorded += f.secs;
    const at = g(f.w, f.start);
    if (at === undefined) continue; // no transcript for this worktree
    covered += f.secs;
    if (at === null) { noEnd += f.secs; if (f.toFail) failsNoEnd++; continue; }
    const rekeyed = (revs.get(f.w) ?? []).some((r) => r.created_at > f.start && r.created_at <= at && touches(r, f.file));
    if (rekeyed) { moot += f.secs; if (f.toFail) failsMoot++; continue; }
    if (!f.stored) {
      // cut today; under the rule it starts at `at`: still cut when a watch revision lands before its usual duration ends
      cutToday += f.secs;
      const u = (med(usual.get(f.file)) ?? f.secs) * 1000;
      if ((revs.get(f.w) ?? []).some((r) => r.created_at > at && r.created_at < at + u)) cutStill += f.secs;
    }
    const key = f.w + "\0" + f.file + "\0" + at;
    if (!groups.has(key)) groups.set(key, { cost: med(usual.get(f.file)) ?? f.secs });
    if (f.toFail) delays.push((at - f.start) / 1000);
  }
  for (const v of groups.values()) kept += v.cost;
  delays.sort((a, b) => a - b);
  const q = (p) => (delays.length ? delays[Math.min(delays.length - 1, Math.floor(p * delays.length))].toFixed(0) : "-");
  const base = covered - noEnd;
  console.log(`${name}: covered ${Math.round(covered)} of ${Math.round(recorded)} s; runs ${Math.round(base)} s -> ${Math.round(kept)} s (saves ${Math.round(base - kept)} s, ${(100 * (base - kept) / base).toFixed(0)}%; re-keyed before the start ${Math.round(moot)} s); no turn end seen ${Math.round(noEnd)} s; stored nothing today and not re-keyed before the start ${Math.round(cutToday)} s, of which a revision still lands during it ${Math.round(cutStill)} s; to-FAIL runs ${delays.length + failsMoot + failsNoEnd}: delayed ${delays.length} (p50 ${q(0.5)} s, p90 ${q(0.9)} s, max ${q(1)} s, ${delays.filter((d) => d > 0).length} later at all; each: ${delays.map((d) => d.toFixed(0)).join(" ")} s), re-keyed before the start ${failsMoot}, no turn end ${failsNoEnd}`);
}
console.log(`${storePath} ${clsPrefix}: ${rows.length} file runs in live worktrees, ${Math.round(rows.reduce((a, f) => a + f.secs, 0))} s, ${rows.filter((f) => !f.stored).length} stored nothing (${Math.round(rows.filter((f) => !f.stored).reduce((a, f) => a + f.secs, 0))} s), to-FAIL runs ${rows.filter((f) => f.toFail).length}`);
replay("recorded (g = s, runs collapsed by file and start)", (w, s) => s);
for (const q of [20, 60, 120, 300]) replay(`quiet ${q} s`, (w, s) => gQuiet(w, s, q * 1000));
replay("turn end", gTurn);
