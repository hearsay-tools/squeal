/*
 * Spec 021 D3 (row 021-09): a daemon that holds the code store's write lock
 * for `holdMs`, for `hold-code-wait.test.ts`. While it holds it, it tries the
 * main store's write lock every 10 ms with a `probeMs` busy timeout and
 * counts the tries that met a holder longer than that.
 *
 *   code-holder <code.sqlite> <store.sqlite> <holdMs> <probeMs>
 *
 * Prints `held` once the code lock is taken, then `{"free":n,"busy":n}`
 * before it commits, and exits 0.
 */
import { DatabaseSync } from "node:sqlite";

const [code, store, hold, probe] = process.argv.slice(2);
if (code === undefined || store === undefined || hold === undefined || probe === undefined) {
  throw new Error("usage: code-holder <code.sqlite> <store.sqlite> <holdMs> <probeMs>");
}
const held = new DatabaseSync(code);
held.exec("BEGIN IMMEDIATE");
const main = new DatabaseSync(store);
main.exec(`PRAGMA busy_timeout = ${Number(probe)}`);
console.log("held");
const counts = { free: 0, busy: 0 };
const end = Date.now() + Number(hold);
const tick = () => {
  if (Date.now() >= end) {
    console.log(JSON.stringify(counts));
    held.exec("COMMIT");
    held.close();
    main.close();
    return;
  }
  try {
    main.exec("BEGIN IMMEDIATE");
    main.exec("ROLLBACK");
    counts.free++;
  } catch {
    counts.busy++;
  }
  setTimeout(tick, 10);
};
tick();
