// Row 021-38: time DROP INDEX states_by_blob on a states table of N rows.
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const N = Number(process.argv[2] ?? 1_000_000);
const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "drop-")), "code.sqlite"));
db.exec("PRAGMA auto_vacuum = INCREMENTAL; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -16384");
db.exec(`CREATE TABLE states (worktree_id TEXT NOT NULL, check_id INTEGER NOT NULL, measure TEXT NOT NULL,
  outcome TEXT NOT NULL, value REAL, threshold REAL, counted_at INTEGER NOT NULL, blob TEXT NOT NULL,
  changed_at INTEGER NOT NULL, edited_revision INTEGER, edited_at INTEGER,
  PRIMARY KEY (worktree_id, check_id, measure)) STRICT, WITHOUT ROWID`);
db.exec("BEGIN");
const st = db.prepare("INSERT INTO states VALUES ('0123456789abcdef', ?, ?, 'pass', 1, 20, 1, ?, 1, NULL, NULL)");
const ms = ["complexity", "crap", "uncovered"];
for (let i = 0; i < N; i++) st.run(Math.floor(i / 3), ms[i % 3], createHash("sha1").update(String(Math.floor(i / 30))).digest("hex"));
db.exec("COMMIT");
db.exec("CREATE INDEX states_by_blob ON states (blob)");
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const pages = db.prepare("PRAGMA page_count").get().page_count;
const a = performance.now();
db.exec("BEGIN IMMEDIATE; DROP INDEX states_by_blob; COMMIT");
console.log(`rows ${N}, pages ${pages}, drop ${(performance.now() - a).toFixed(0)} ms, load ${(await import("node:os")).loadavg()[0].toFixed(1)}`);
