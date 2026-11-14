// Throwaway #220 probe: a fake write-lock holder on a scratch SQLite file.
// It runs short write transactions back to back, as the code-store prune's
// `deleteInBatches` does, holding each for `holdMs` without CPU work
// (Atomics.wait sleeps), with `gapMs` between COMMIT and the next BEGIN.
import { DatabaseSync } from "node:sqlite";
const [file, holdMs, gapMs, forMs] = process.argv.slice(2).map((v, i) => (i === 0 ? v : Number(v)));
const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
const nap = new Int32Array(new SharedArrayBuffer(4));
const end = Date.now() + forMs;
let n = 0;
process.send?.("ready");
while (Date.now() < end) {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch {
    continue; // busy past its own 5 s timeout: try again, as a daemon slice would
  }
  db.exec(`INSERT INTO t(v) VALUES (${n++})`);
  Atomics.wait(nap, 0, 0, holdMs);
  db.exec("COMMIT");
  if (gapMs > 0) Atomics.wait(nap, 0, 0, gapMs);
}
process.send?.({ holderTransactions: n });
db.close();
