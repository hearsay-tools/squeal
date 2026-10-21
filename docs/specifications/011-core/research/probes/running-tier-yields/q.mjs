import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.STORE ?? "/tmp/r381/cezar-store.sqlite", { readOnly: true });
const sql = process.argv[2];
const rows = db.prepare(sql).all();
for (const r of rows) console.log(JSON.stringify(r));
