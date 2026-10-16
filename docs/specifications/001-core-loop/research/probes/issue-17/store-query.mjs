// Throwaway (research issue-17). Read-only SQL on a fixture's Squeal store.
// usage: node store-query.mjs <store.sqlite> "<sql>"
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const row of db.prepare(process.argv[3]).all()) console.log(JSON.stringify(row));
db.close();
