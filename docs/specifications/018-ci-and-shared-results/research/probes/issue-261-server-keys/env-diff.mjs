// Throwaway (row 018-72): server environment descriptors in squawk's store (read-only), in
// recorded order, each against the one before: which parts differ. Usage: node env-diff.mjs [project] [sinceIso]
import { DatabaseSync } from "node:sqlite";
const [project = "server", since = "2026-11-14T00:00:00Z"] = process.argv.slice(2);
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const rows = db.prepare("select hash, descriptor d, recorded_at t from environments where json_extract(descriptor,'$.project') = ? and recorded_at >= ? order by recorded_at").all(project, Date.parse(since));
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === "object" && !Array.isArray(v)) flat(v, p + k + ".", out); else out[p + k] = JSON.stringify(v); } return out; };
const used = db.prepare("select count(*) n from import_files where environment = ?");
let prev = null;
for (const r of rows) {
  const d = JSON.parse(r.d), f = flat(d);
  const diff = prev === null ? [] : [...new Set([...Object.keys(f), ...Object.keys(prev)])].filter((k) => f[k] !== prev[k]).map((k) => k === "files" ? `files: +${JSON.parse(f[k] ?? "[]").filter((x) => !(prev[k] ?? "").includes(JSON.stringify(x))).map((x) => x[0] ?? x).join(",")} -${JSON.parse(prev[k] ?? "[]").filter((x) => !(f[k] ?? "").includes(JSON.stringify(x))).map((x) => x[0] ?? x).join(",")}` : `${k}: ${(prev[k] ?? "").slice(0, 60)} -> ${(f[k] ?? "").slice(0, 60)}`);
  console.log(new Date(r.t).toISOString(), r.hash.slice(0, 10), `ci=${d.ci}`, `squeal adapter=${d.adapterVersion}`, `importRows=${used.get(r.hash).n}`, diff.join(" | "));
  if (!d.ci) prev = f;
}
