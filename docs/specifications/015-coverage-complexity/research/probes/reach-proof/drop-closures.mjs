import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
const before = db.prepare("select count(*) n from test_files").get().n;
db.exec("delete from test_files");
console.log("test_files rows removed:", before);
db.close();
