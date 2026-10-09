import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const best = new Map();
for (const r of db.prepare("select log_dir from runs").all()) {
  try { for (const f of JSON.parse(readFileSync(r.log_dir + "/report.json", "utf8")).report.fileDurations ?? []) best.set(f.testFile.path, Math.max(best.get(f.testFile.path) ?? 0, f.durationMs)); } catch {}
}
console.log([...best].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3] ?? 12)).map(([p, d]) => `${Math.round(d)} ${p}`).join("\n"));
