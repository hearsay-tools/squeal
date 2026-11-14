// Throwaway probe (row 020-56, #212). Reads cezar's Squeal main store read-only
// (`?immutable=1`) and gives, for the changed source files a pattern matches,
// the test files of one project whose stored closure loads them, with their
// summed stored seconds and D17.1's estimate at a width: the files the early
// stop (row 020-46) runs for #212's six non-setup files.
// #212 does not name the six files; the pattern is a stand-in ("preview").
// Usage: node cezar-loaders.mjs <store.sqlite> <checkout> <project> <width> <regex>
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [storePath, checkout, project, widthArg, pattern] = process.argv.slice(2);
const width = Number(widthArg);
const re = new RegExp(pattern);
const db = new DatabaseSync(`file:${storePath}?immutable=1`, { readOnly: true });
const rows = db
  .prepare("select path, closure_paths from test_files where project = ?")
  .all(project)
  .filter((r) => existsSync(join(checkout, r.path)));
const sources = new Map();
const loaders = [];
for (const row of rows) {
  const hits = JSON.parse(row.closure_paths).filter(
    (p) => re.test(p) && !/\.test\.[cm]?[jt]sx?$/.test(p) && existsSync(join(checkout, p)),
  );
  if (hits.length === 0) continue;
  loaders.push(row.path);
  for (const p of hits) sources.set(p, (sources.get(p) ?? 0) + 1);
}
const newest = db.prepare(`
  SELECT c.kind, r.duration_ms FROM checks c JOIN results r ON r.check_id = c.id
  WHERE c.project = ? AND c.test_path = ? AND r.key = (
    SELECT r2.key FROM checks c2 JOIN results r2 ON r2.check_id = c2.id
    WHERE c2.project = ? AND c2.test_path = ?
    ORDER BY r2.recorded_at DESC, r2.rowid DESC LIMIT 1)`);
const secs = loaders.map((path) => {
  let f = 0, t = 0;
  for (const r of newest.all(project, path, project, path)) {
    if (r.kind === "file") f = Math.max(f, r.duration_ms); else t += r.duration_ms;
  }
  return Math.max(f, t) / 1000;
});
const sum = secs.reduce((a, b) => a + b, 0);
console.log(JSON.stringify({
  project, pattern, testFiles: rows.length, sources: Object.fromEntries([...sources].sort((a, b) => b[1] - a[1]).slice(0, 12)),
  sourceCount: sources.size, loaders: loaders.length, summedSeconds: Math.round(sum),
  longest: Math.max(0, ...secs), estimateAtWidth: Math.ceil(Math.max(Math.max(0, ...secs), sum / width)), width,
}, null, 1));
