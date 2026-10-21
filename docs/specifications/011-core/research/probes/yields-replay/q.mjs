import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.STORE ?? "/tmp/r68/cezar-store.sqlite", { readOnly: true });
for (const r of db.prepare(process.argv[2]).all()) console.log(JSON.stringify(r));
