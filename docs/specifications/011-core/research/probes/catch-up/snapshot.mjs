// THROWAWAY probe (011-core/research/catch-up.md). Copies cezar's store through a read-only
// connection (`VACUUM INTO`), so every replay reads the copy and the live file is opened once.
import { DatabaseSync } from "node:sqlite";
const [src, dest] = process.argv.slice(2);
const db = new DatabaseSync(src, { readOnly: true });
const t = Date.now();
db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
db.close();
console.log(`copied ${src} to ${dest} in ${Date.now() - t} ms`);
