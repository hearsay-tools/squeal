import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/agent/projects/cezar/.git/squeal/store.sqlite', { readOnly: true });
const rows = db.prepare(process.argv[2]).all();
if (rows.length) console.log(Object.keys(rows[0]).join('\t'));
for (const r of rows.slice(0, Number(process.argv[3] ?? 80))) console.log(Object.values(r).map(v => String(v).slice(0, Number(process.argv[4] ?? 200))).join('\t'));
console.log(`(${rows.length} rows)`);
