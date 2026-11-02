// Throwaway probe for 019 commit-checkpoint (see README.md). Copies the
// fixture's Squeal store to a temporary file and prints its revisions and
// head-move meta rows. Usage: node store.mjs <fixture repo root>.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.argv[2];
const dir = join(root, ".git", "squeal");
const name = readdirSync(dir).find((f) => f === "store.sqlite");
if (name === undefined) throw new Error(`no store in ${dir}`);
const copy = mkdtempSync(join(tmpdir(), "cc-store-"));
for (const suffix of ["", "-wal", "-shm"]) {
  const from = join(dir, name + suffix);
  if (existsSync(from)) copyFileSync(from, join(copy, name + suffix));
}
const db = new DatabaseSync(join(copy, name), { readOnly: true });
const columns = db.prepare("PRAGMA table_info(revisions)").all().map((c) => c.name);
const wanted = ["number", "head", "dirty", "trigger"].filter((c) => columns.includes(c));
for (const row of db.prepare(`SELECT ${wanted.join(", ")} FROM revisions ORDER BY number`).all()) {
  console.log(`revision ${wanted.map((c) => `${c}=${String(row[c]).slice(0, 12)}`).join(" ")}`);
}
for (const row of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'head-move.%'").all()) {
  console.log(`meta ${row.key.slice(0, 10)}… ${row.value}`);
}
db.close();
rmSync(copy, { recursive: true, force: true });
