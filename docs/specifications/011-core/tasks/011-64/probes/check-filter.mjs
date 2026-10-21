// THROWAWAY probe (011-64 design, question 1). The `--check` filter with one formatter: the
// failing checks' names are read in SQL, matched in JS by the printed name (as `formatCheck`
// prints it, copied here), and the list is then filtered by those ids in SQL. One read
// transaction; times the whole and each part, with the load.
// Usage: STORE=<copy.sqlite> CHECK=<name part> node check-filter.mjs
import { loadavg } from "node:os";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.STORE ?? "/tmp/t64/cezar-store.sqlite", { readOnly: true });
const part = process.env.CHECK ?? "autosave";
// src/core/state/check-name.ts at 775dfe14f.
const formatCheck = (c) => {
  const project = c.project === "" ? "" : `[${c.project}] `;
  if (c.kind === "setup") return `${project}${c.test_path === "" ? "" : `${c.test_path} `}(global setup)`;
  return c.kind === "test" ? `${project}${c.test_path} > ${c.full_name}` : `${project}${c.test_path} (file-level)`;
};
const FAILING_CHECKS = `SELECT DISTINCT c.id, c.project, c.test_path, c.kind, c.full_name
  FROM results r INDEXED BY results_by_failure JOIN checks c ON c.id = r.check_id
  WHERE r.failure_id IS NOT NULL AND r.outcome = 'fail'`;
const LIST = `SELECT r.*, f.summary, f.errors FROM results r INDEXED BY results_by_failure
  LEFT JOIN failure_texts f ON f.id = r.failure_id
  WHERE r.failure_id IS NOT NULL AND r.outcome = 'fail' AND r.check_id IN (SELECT value FROM json_each(?))
  ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`;
const times = [];
let found = 0;
let checks = 0;
for (let i = 0; i < 7; i++) {
  const t0 = performance.now();
  db.exec("BEGIN");
  const failing = db.prepare(FAILING_CHECKS).all();
  const t1 = performance.now();
  const ids = failing.filter((c) => formatCheck(c).includes(part)).map((c) => c.id);
  const rows = db.prepare(LIST).all(JSON.stringify(ids), 100);
  db.exec("COMMIT");
  times.push([performance.now() - t0, t1 - t0]);
  found = rows.length;
  checks = failing.length;
}
times.sort((a, b) => a[0] - b[0]);
const [total, read] = times[3];
console.log(
  `${new Date().toISOString()} load ${loadavg()[0].toFixed(2)}: ${checks} failing checks, "${part}" lists ${found}; median ${total.toFixed(1)} ms (failing checks read ${read.toFixed(1)} ms)`,
);
