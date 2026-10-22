import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/tmp/el115/store/store.sqlite', { readOnly: false });
const sql = process.argv[2];
const rows = db.prepare(sql).all();
for (const r of rows) console.log(JSON.stringify(r));
