// 011-82 probe: the run logs whose adapter failure withheld files (tasks 001-146, 001-159), and which path it named. Read-only.
// Usage: node withheld.mjs <runs-dir> <hours>
import { readFileSync, readdirSync, existsSync } from "node:fs";
const dir = process.argv[2]; const sinceMs = Date.now() - Number(process.argv[3]) * 3600_000;
let runs = 0, hit = 0, files = 0, withheld = 0, whole = 0; const why = {};
for (const d of readdirSync(dir)) {
  const p = `${dir}/${d}/report.json`; if (!existsSync(p)) continue;
  let r; try { r = JSON.parse(readFileSync(p, "utf8")).report; } catch { continue; }
  // mtime filter via the log name is not kept; use the file's mtime
  const { mtimeMs } = (await import("node:fs")).statSync(p); if (mtimeMs < sinceMs) continue;
  runs++;
  const f = r.failure ?? ""; const w = (r.withheld ?? []).length;
  if (!/no check key names/.test(f) || w === 0) continue;
  hit++; withheld += w; files += w + r.completedFiles.length;
  if (r.completedFiles.length === 0) whole++;
  const m = f.match(/since (.*?) (changed on disk|was written|were written)/); const k = (m?.[1] ?? "?").replace(/[^ ]*\/(e2e)\/[^ ]*/g, "<…/e2e/…>");
  const kind = /001-146/.test(f) ? "001-146 moved" : "001-159 touched";
  why[kind + ": " + k.slice(0, 80)] = (why[kind + ": " + k.slice(0, 80)] ?? 0) + w;
}
console.log({ runs, runsWithWithheld: hit, withheld, completedPlusWithheld: files, runsAllWithheld: whole });
console.log(Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 12));
