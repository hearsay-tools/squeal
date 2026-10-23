// Throwaway (issue 86): holds the synthetic store's write lock for argv[3] ms.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
db.exec("PRAGMA busy_timeout = 0");
db.exec("BEGIN IMMEDIATE");
process.stdout.write("held\n");
setTimeout(() => { db.exec("COMMIT"); db.close(); process.stdout.write("freed\n"); }, Number(process.argv[3]));
