// Throwaway probe (022-02): the paths most often in a test file's newest coverage
// record but not in its stored closure list. Same inputs as loaded-vs-closure.mts.
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";
const [storePath, codePath] = process.argv.slice(2);
const store = new DatabaseSync(storePath, { readOnly: true });
const code = new DatabaseSync(codePath, { readOnly: true });
const recorded = new Set((code.prepare("SELECT result_key FROM coverage").all() as any[]).map((r) => r.result_key));
const keys = store.prepare(`SELECT r.key FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind='file' AND c.project=? AND c.test_path=? ORDER BY r.recorded_at DESC`);
const at = code.prepare("SELECT record FROM coverage WHERE result_key=? ORDER BY provider_version DESC LIMIT 1");
const count = new Map<string, number>();
for (const row of store.prepare("SELECT project, path, closure_paths FROM test_files").all() as any[]) {
  const k = (keys.all(row.project, row.path) as any[]).find((k) => recorded.has(k.key));
  if (!k) continue;
  const json = JSON.parse(inflateRawSync((at.get(k.key) as any).record).toString("utf8"));
  const L: string[] = Array.isArray(json.parts) ? json.unread : [...json.sources.map((s: any) => s.path), ...json.unread];
  const S = new Set(JSON.parse(row.closure_paths));
  for (const p of L) if (!S.has(p)) count.set(`${row.project}  ${p}`, (count.get(`${row.project}  ${p}`) ?? 0) + 1);
}
for (const [p, n] of [...count].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(n, p);
