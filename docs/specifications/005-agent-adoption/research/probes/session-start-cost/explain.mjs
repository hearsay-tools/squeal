// Throwaway. EXPLAIN QUERY PLAN of every statement step-budget.ts recorded with FULL=1 (over 5 ms
// in a run), on the store copies, read-only. Usage: node explain.mjs <series.jsonl> <copy-common-dir>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [file, common] = process.argv.slice(2);
const seen = new Map();
for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
  const row = JSON.parse(line);
  for (const s of row.full ?? []) if (!s.sql.startsWith("exec:") && s.sql !== "prepare") seen.set(s.sql, s.db);
}
const dbs = {};
for (const [sql, db] of seen) {
  const name = db || "store.sqlite";
  dbs[name] ??= new DatabaseSync(`${common}/squeal/${name}`, { readOnly: true });
  let plan;
  try { plan = dbs[name].prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail); }
  catch (e) { plan = [`(error: ${e.message})`]; }
  console.log(`-- ${name}: ${sql.replace(/\s+/g, " ").slice(0, 160)}`);
  for (const d of plan) console.log(`     ${d}`);
}
