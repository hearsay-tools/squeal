// Throwaway probe for 015-10 Part C. Not product code. Run as squeal-e2e.
//   node included.mjs <code.sqlite>   prints the counted paths (not too big), read only
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const r of db.prepare("SELECT DISTINCT path FROM files WHERE too_big = 0 ORDER BY path").all()) console.log(r.path);
