// 011-148 probe (throwaway): stored-nothing groups with a tighter bound for files cut mid-run: min(wall, 2 x the file's usual duration).
// Usage: node bounds.mjs <store copy> <fate.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, fatePath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const usual = new Map();
for (const r of db.prepare("SELECT c.project p, c.test_path t, r.duration_ms d FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.duration_ms > 0").all()) { const k = r.p + "\0" + r.t; (usual.get(k) ?? usual.set(k, []).get(k)).push(r.d / 1000); }
const med = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const rows = readFileSync(fatePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t = {}; let total = 0, totalT = 0;
for (const r of rows) {
  const tight = r.est === "wall-started" ? Math.min(r.secs, 2 * (med(usual.get(r.file)) ?? r.secs)) : r.secs;
  total += r.secs; totalT += tight;
  const g = r.stored ? "stored" : r.fate.replace(/:no-report.*/, ":no-report").replace(/^not-ended:failure.*/, "not-ended:withheld-run") + (r.live ? "" : " [removed worktree]");
  t[g] ??= [0, 0, 0]; t[g][0] += r.secs; t[g][1] += tight; t[g][2]++;
}
console.log(`total ${Math.round(total)} s (tight ${Math.round(totalT)} s)`);
for (const [k, [s, tt, n]] of Object.entries(t).sort((a, b) => b[1][0] - a[1][0])) console.log(`${k} | ${Math.round(s)} | ${(100 * s / total).toFixed(1)}% | tight ${Math.round(tt)} (${(100 * tt / totalT).toFixed(1)}%) | ${n}`);
