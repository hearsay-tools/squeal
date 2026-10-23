import { DatabaseSync } from "node:sqlite";
const [, , store, a, b, rev = "0"] = process.argv;
const db = new DatabaseSync(store, { readOnly: true });
const q = db.prepare("SELECT c.test_path t, r.key, r.recorded_at at, r.commit_sha c, r.dirty d FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind='file' AND r.worktree_id = ? AND r.revision = ?");
const A = new Map(q.all(a, Number(rev)).map((r) => [r.t, r])), B = new Map(q.all(b, Number(rev)).map((r) => [r.t, r]));
let same = 0, diff = 0, ex = [];
for (const [t, r] of A) { const s = B.get(t); if (!s) continue; if (s.key === r.key) same++; else { diff++; if (ex.length < 5) ex.push(t); } }
console.log(`A ${A.size} B ${B.size} both ${same + diff}: same key ${same}, different ${diff}`, ex);
