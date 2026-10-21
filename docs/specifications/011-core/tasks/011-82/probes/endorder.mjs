// 011-82 probe: the order in which the modules of a large tier ended, as pick positions (0 = first picked). Read-only.
// Usage: node endorder.mjs <store.sqlite> <runs-dir> <tiers.json> <1 cancelled | 0 finished>
import { DatabaseSync } from "node:sqlite"; import { readFileSync, existsSync } from "node:fs";
const [, , store, runsDir, tiersJson, cancelledArg = "1"] = process.argv;
const want = cancelledArg === "1";
const db = new DatabaseSync(store, { readOnly: true });
const tiers = JSON.parse(readFileSync(tiersJson, "utf8")).rows.filter((t) => t.files >= 40 && t.report && t.cancelled === want && t.cause !== "squeal stop");
const runs = new Map(db.prepare("SELECT id, test_files FROM runs WHERE started_at >= ?").all(Date.now() - 48 * 3600e3).map((r) => [r.id.slice(0, 8), r]));
let shown = 0;
for (const t of tiers.sort((a, b) => b.wallS - a.wallS)) {
  const run = runs.get(t.id); const log = `${runsDir}/${run.id}/vitest.log`; if (!existsSync(log)) continue;
  const order = JSON.parse(run.test_files).map((f) => (f.project ? `[${f.project}] ${f.path}` : f.path));
  const ends = readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("MODULE ")).map((l) => order.indexOf(l.split(" ").slice(2).join(" ")));
  console.log(t.at, t.worktree, `${t.files}f ${t.wallS}s ended ${ends.length}:`, ends.slice(0, 40).join(","));
  if (++shown >= 8) break;
}
