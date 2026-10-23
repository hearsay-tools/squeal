import { DatabaseSync } from "node:sqlite";
const [, , store, ...sqls] = process.argv;
const db = new DatabaseSync(store, { readOnly: true });
for (const s of sqls) { for (const r of db.prepare(s).all()) console.log(JSON.stringify(r)); console.log("--"); }
