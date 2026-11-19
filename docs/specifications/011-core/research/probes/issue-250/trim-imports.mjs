// Throwaway probe (row 011-408): on a COPIED store, park all but the newest <keep> imports in side tables, or restore them.
// usage: node trim-imports.mjs <copy.sqlite> keep <n> | restore
import { DatabaseSync } from "node:sqlite";
const [file, mode, n] = process.argv.slice(2);
if (!file.includes("/t/")) throw new Error(`refusing a non-scratch path: ${file}`);
const db = new DatabaseSync(file);
db.exec("BEGIN");
if (mode === "restore") {
  db.exec("INSERT INTO imports SELECT * FROM parked_imports; INSERT INTO import_files SELECT * FROM parked_import_files; DROP TABLE parked_imports; DROP TABLE parked_import_files;");
} else {
  db.exec("CREATE TABLE parked_imports AS SELECT * FROM imports WHERE id NOT IN (SELECT id FROM imports ORDER BY imported_at DESC LIMIT " + Number(n) + ")");
  db.exec("CREATE TABLE parked_import_files AS SELECT * FROM import_files WHERE import_id IN (SELECT id FROM parked_imports)");
  db.exec("DELETE FROM import_files WHERE import_id IN (SELECT id FROM parked_imports); DELETE FROM imports WHERE id IN (SELECT id FROM parked_imports);");
}
db.exec("COMMIT");
console.log(db.prepare("SELECT (SELECT count(*) FROM imports) AS imports, (SELECT count(*) FROM import_files) AS files").get());
