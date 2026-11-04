#!/usr/bin/env node
// Throwaway probe for 019-40. Not product code. Runs as squeal-e2e (as-e2e.mjs), read only.
//   node lintstore.mjs <clone>
// <clone>'s lint store (.git/squeal/lint.sqlite): the first 12 rows of each table and every meta
// row. After s1f it showed P12: a failing state, no transition, no view.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(`${process.argv[2]}/.git/squeal/lint.sqlite`, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
console.log("tables:", tables.join(" "));
for (const t of tables.filter((n) => n !== "meta")) {
  console.log("==", t);
  for (const r of db.prepare(`SELECT * FROM ${t} LIMIT 12`).all()) console.log(JSON.stringify(r).slice(0, 500));
}
for (const r of db.prepare("SELECT key, value FROM meta").all()) console.log("meta", r.key, String(r.value).slice(0, 500));
