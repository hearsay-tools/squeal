import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync("stores/cezar/store.sqlite", { readOnly: true });
const rows = readFileSync("an/first-cezar.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const at = db.prepare("SELECT r.worktree_id w, r.duration_ms d, r.recorded_at t FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND c.project = ? AND c.test_path = ? AND r.key = ?");
let keyed = 0, sameBefore = 0, ranLaterHere = 0, secsHere = 0, foreignLater = 0, nCk = new Set();
for (const o of rows) { nCk.add(o.ck); if (!o.key) continue; keyed++; if (o.sameKeyBefore?.length) sameBefore++; const [p, t] = o.file.split("\0");
  for (const r of at.all(p, t, o.key)) { if (r.w === o.w) { ranLaterHere++; secsHere += r.d / 1000; } else if (r.t > o.ckStart) foreignLater++; } }
console.log(`cezar first starts ${nCk.size}, misses ${rows.length}, baseline ran 0 (lookup-only); key known ${keyed}; a row at the key before the start ${sameBefore}; stored later at that key by the worktree itself ${ranLaterHere} (${Math.round(secsHere)} s), by another worktree after the start ${foreignLater}`);
