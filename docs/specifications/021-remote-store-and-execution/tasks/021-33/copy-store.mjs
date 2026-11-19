import { DatabaseSync } from "node:sqlite";
const [src, dst] = process.argv.slice(2);
const db = new DatabaseSync(src, { readOnly: true });
db.exec("PRAGMA busy_timeout = 60000");
const t = performance.now();
db.exec(`VACUUM INTO '${dst}'`);
console.log(src, "->", dst, Math.round(performance.now() - t), "ms");
db.close();
