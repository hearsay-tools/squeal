// 011-157 probe (throwaway), questions 1 and 4: do the main checkout's stored keys equal a linked worktree's at equal closure content?
// For each file: the main checkout's stored rows (commit known) against linked worktrees' rows, within 24 h of each other.
// Counts pairs by (equal signature, equal key). With "control": pairs of two linked worktrees instead, the same way.
// Usage: node validate.mjs <store copy> <repo root> [max pairs per file=3] [control]
import { DatabaseSync } from "node:sqlite"; import { makeSig } from "./sig.mjs";
const [, , storePath, root, maxArg, mode] = process.argv; const max = Number(maxArg ?? 3);
const db = new DatabaseSync(storePath, { readOnly: true });
const { sig } = makeSig(db, root + "/.git", root + "/squeal.config.json");
const main = db.prepare("SELECT id FROM worktrees WHERE is_main = 1").get().id;
const rows = db.prepare("SELECT c.project || char(0) || c.test_path f, r.key, r.commit_sha c, r.dirty d, r.worktree_id w, max(r.recorded_at) at FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.commit_sha IS NOT NULL GROUP BY f, r.key, r.worktree_id").all();
const by = new Map(); for (const r of rows) { if (!by.has(r.f)) by.set(r.f, []); by.get(r.f).push(r); }
const cnt = {}, ex = {}; let files = 0;
for (const [f, rs] of by) {
  const linked = rs.filter((r) => r.w !== main && r.d === 0);
  const m = mode === "control" ? linked.slice(0, 1) : rs.filter((r) => r.w === main), l = mode === "control" ? linked.filter((r) => r.w !== linked[0]?.w) : linked; if (!m.length || !l.length) continue; files++;
  let k = 0;
  for (const a of m) for (const b of l) {
    if (Math.abs(a.at - b.at) > 86400_000 || k >= max) continue; k++;
    const sa = sig(f, a.c), sb = sig(f, b.c); if (sa === null || sb === null) continue;
    const c = `${sa === sb ? "equal content" : "content differs"}, ${a.key === b.key ? "equal key" : "key differs"}`; cnt[c] = (cnt[c] ?? 0) + 1;
    if (sa === sb && a.key !== b.key) (ex[f] ??= []).push({ main: a.c.slice(0, 9), linked: b.c.slice(0, 9), w: b.w });
  }
}
console.log(`files with main and linked rows: ${files}`); console.log(cnt);
const exs = Object.entries(ex); console.log(`files with equal content and different keys: ${exs.length}`); for (const [f, e] of exs.slice(0, 15)) console.log(f.replace("\0", " :: "), JSON.stringify(e[0]));
