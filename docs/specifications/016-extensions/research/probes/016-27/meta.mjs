// Throwaway probe (016-27): lists meta rows whose key matches a LIKE pattern, with value length and head. Read-only.
import { DatabaseSync } from "node:sqlite";
const [file, ...patterns] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const q = db.prepare("select key, length(value) l, substr(value, 1, 240) v from meta where key like ? order by key");
for (const p of patterns) for (const r of q.all(p)) console.log(r.key, r.l, r.v);
