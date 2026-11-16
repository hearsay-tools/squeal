// Throwaway (environment-at-commit): rows and bytes of a table that records
// each environment hash by the commit a daemon saw it at. Counts distinct
// clean heads a local daemon had per day over <days> days (revisions plus
// clean result labels, as share.mjs), times the projects, and measures the
// bytes per row in a scratch SQLite file (dbstat). Also the size of the
// existing environments table. Usage: node record-size.mjs <scratch store> <days> <scratch dir>
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [store, days, dir] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const since = Date.now() - Number(days) * 86400000;
let imported = new Set();
try { imported = new Set(db.prepare("select id from imports").all().map((r) => r.id)); } catch {}
const seen = [
  ...db.prepare("select head, created_at as at from revisions where dirty = 0 and head is not null").all(),
  ...db.prepare("select commit_sha as head, worktree_id, first_at as at from clean_labels").all().filter((r) => !r.worktree_id.startsWith("import") && !imported.has(r.worktree_id)),
].filter((r) => r.at >= since);
const heads = new Set(seen.map((r) => r.head));
const projects = db.prepare("select distinct project from worktree_environment_hashes").all().map((r) => r.project);
const env = db.prepare("select count(*) n, sum(length(descriptor)) bytes from environments").get();
const rows = heads.size * projects.length;
// Bytes per row, measured.
const path = `${dir}/record-size.sqlite`;
rmSync(path, { force: true });
const s = new DatabaseSync(path);
s.exec("CREATE TABLE environment_commits (commit_id BLOB NOT NULL, project TEXT NOT NULL, hash BLOB NOT NULL, recorded_at INTEGER NOT NULL, PRIMARY KEY (commit_id, project)) STRICT, WITHOUT ROWID");
const ins = s.prepare("INSERT INTO environment_commits VALUES (?, ?, ?, ?)");
const n = 20000;
s.exec("BEGIN");
for (let i = 0; i < n; i++) ins.run(randomBytes(20), projects[i % projects.length], randomBytes(32), Date.now());
s.exec("COMMIT");
let perRow = null;
try { perRow = s.prepare("select sum(pgsize) b from dbstat where name = 'environment_commits'").get().b / n; } catch {}
s.close();
rmSync(path, { force: true });
console.log(JSON.stringify({ days: Number(days), cleanHeadsSeen: heads.size, perDay: +(heads.size / Number(days)).toFixed(1), projects: projects.length, rows, bytesPerRow: perRow && +perRow.toFixed(1), totalKB: perRow && +((rows * perRow) / 1024).toFixed(1), environmentsTable: { rows: env.n, descriptorKB: +(env.bytes / 1024).toFixed(1) } }));
