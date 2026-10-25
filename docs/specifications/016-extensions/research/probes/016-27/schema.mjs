// Throwaway probe (016-27): prints a store's schema and meta key groups. Opens the store read-only.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const r of db.prepare("select name, sql from sqlite_master where type in ('table','index')").all())
  console.log(r.name, "\n ", r.sql);
console.log(db.prepare("pragma user_version").get());
const rows = db.prepare("select key, length(value) l from meta order by key").all();
const groups = {};
for (const r of rows) {
  const g = r.key.replace(/[:.][^:.]*$/, "");
  groups[g] = (groups[g] || 0) + 1;
}
console.log(groups);
