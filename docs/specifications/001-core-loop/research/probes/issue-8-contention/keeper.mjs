// Throwaway: stands in for a live daemon's connection: opens the disposable
// store, reads once, and stays open idle for <ms>. Usage: node keeper.mjs <store.sqlite> <ms>
import { DatabaseSync } from "node:sqlite";
const [file, ms] = [process.argv[2], Number(process.argv[3])];
if (!/\/tmp\//.test(file)) throw new Error(`refusing a store outside /tmp: ${file}`);
const db = new DatabaseSync(file);
db.prepare("SELECT count(*) FROM meta").get();
console.log("keeper open");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
db.close();
