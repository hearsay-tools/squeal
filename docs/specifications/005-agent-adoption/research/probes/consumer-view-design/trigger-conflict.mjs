// Throwaway (row 005-104). In memory: does an outer INSERT OR REPLACE (the form every known_states
// writer uses) change what a trigger's own insert does? Three trigger bodies keep a birth mark per
// row; the mark must not change when the row is rewritten. Usage: node trigger-conflict.mjs
import { DatabaseSync } from "node:sqlite";
const forms = {
  "INSERT OR IGNORE": "INSERT OR IGNORE INTO born (k) VALUES (NEW.k)",
  "INSERT ... ON CONFLICT DO NOTHING (upsert)": "INSERT INTO born (k) VALUES (NEW.k) ON CONFLICT DO NOTHING",
  "INSERT ... SELECT ... WHERE NOT EXISTS": "INSERT INTO born (k) SELECT NEW.k WHERE NOT EXISTS (SELECT 1 FROM born WHERE k = NEW.k)",
};
console.log(`SQLite ${new DatabaseSync(":memory:").prepare("SELECT sqlite_version() v").get().v}`);
for (const [name, body] of Object.entries(forms)) {
  for (const outer of ["INSERT OR REPLACE", "INSERT ... ON CONFLICT DO UPDATE"]) {
    const d = new DatabaseSync(":memory:");
    d.exec(`CREATE TABLE s (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE born (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT UNIQUE);
      CREATE TRIGGER t AFTER INSERT ON s BEGIN ${body}; END;`);
    const write = outer === "INSERT OR REPLACE"
      ? d.prepare("INSERT OR REPLACE INTO s (k, v) VALUES (?, ?)")
      : d.prepare("INSERT INTO s (k, v) VALUES (?, ?) ON CONFLICT DO UPDATE SET v = excluded.v");
    write.run("a", "1"); write.run("b", "1");
    const first = d.prepare("SELECT id FROM born WHERE k = 'a'").get().id;
    write.run("a", "2"); write.run("a", "3");
    const after = d.prepare("SELECT id FROM born WHERE k = 'a'").get().id;
    console.log(`${outer} outside, ${name} in the trigger: birth mark of a ${first} -> ${after}${first === after ? " (kept)" : " (CHANGED)"}`);
  }
}
