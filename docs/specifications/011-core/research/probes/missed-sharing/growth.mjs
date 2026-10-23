// 011-152 probe (throwaway): when each observed path of a test file first appears in a run report of the log snapshot (an upper bound on when the
// shared observed set gained it: reports of pruned runs are gone). Writes one line per (file, path) with its first report time.
// Usage: node growth.mjs <store copy> <run-log snapshot> <out.json>
import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [, , storePath, logs, outPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const first = {};
for (const run of db.prepare("SELECT id, log_dir, started_at FROM runs ORDER BY started_at").all()) {
  const p = logs + "/" + run.log_dir.split("/").pop() + "/report.json"; if (!existsSync(p)) continue;
  let rep; try { rep = JSON.parse(readFileSync(p, "utf8")).report; } catch { continue; }
  for (const o of rep.observed ?? []) { const f = (first[o.testFile.project + "\0" + o.testFile.path] ??= {}); for (const q of [...(o.paths ?? []), ...(o.directories ?? []).map((d) => (d.endsWith("/") ? d : d + "/"))]) f[q] ??= run.started_at; }
}
writeFileSync(outPath, JSON.stringify(first));
console.log("files", Object.keys(first).length, "pairs", Object.values(first).reduce((a, f) => a + Object.keys(f).length, 0));
