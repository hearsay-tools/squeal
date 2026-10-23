import { DatabaseSync } from "node:sqlite";
const [, , p, ...sql] = process.argv;
const db = new DatabaseSync(p, { readOnly: true });
for (const s of sql) { const rows = db.prepare(s).all(); console.log(rows.length > 60 ? JSON.stringify(rows.slice(0,60)) + ` ...(${rows.length})` : rows.map(r=>JSON.stringify(r)).join("\n")); }
