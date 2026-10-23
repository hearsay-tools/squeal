// 011-157 probe (throwaway), question 5: what each linked worktree's first start missed (its first baseline checkpoint's test files), in recorded
// seconds: what it ran (stored rows of its runs) and what the misses would cost at their files' median durations. Usage: node startmiss.mjs <store copy> <copy ms> <cov.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, copyArg, covPath] = process.argv; const db = new DatabaseSync(storePath, { readOnly: true });
const usual = new Map();
for (const c of db.prepare("SELECT c.project, c.test_path, group_concat(r.duration_ms) d FROM checks c JOIN results r ON r.check_id = c.id WHERE c.kind = 'file' GROUP BY c.id").all()) { const d = c.d.split(",").map(Number).sort((a, b) => a - b); usual.set(c.project + "\0" + c.test_path, d[d.length >> 1] / 1000); }
const cov = readFileSync(covPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
let n = 0, miss = 0, missSecs = 0, starts = 0;
for (const c of cov) {
  const k = db.prepare("SELECT test_files FROM checkpoints WHERE worktree_id = ? AND kind = 'baseline' ORDER BY started_at LIMIT 1").get(c.w); if (!k) continue;
  const fs = JSON.parse(k.test_files); starts++; n += c.n; miss += fs.length; missSecs += fs.reduce((x, f) => x + (usual.get(f.project + "\0" + f.path) ?? 0), 0);
}
console.log(`first starts with a baseline checkpoint ${starts} of ${cov.length}; files ${n}; missed ${miss}, ${Math.round(missSecs)} s at median durations`);
