/*
 * Child process for the concurrent-open test. Run through `spawnChild` in
 * `spawn.ts`.
 *
 *   opener <baseDir> <id> <parties> <rounds>
 *
 * Round `r` opens the store under `<baseDir>/<r mod (rounds/2)>/.git`: the
 * first half of the rounds create the stores, the second half reopen them.
 * Each round starts once every party has arrived at it, so the opens overlap.
 * Prints one JSON line: the rounds whose open threw, with the error.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/index.js";

const [baseDir, id, parties = "8", rounds = "20"] = process.argv.slice(2);
if (!baseDir || !id) throw new Error("usage: opener <baseDir> <id> <parties> <rounds>");

const half = Number(rounds) / 2;
const failures: { round: number; error: string }[] = [];
for (let round = 0; round < Number(rounds); round++) {
  const barrier = join(baseDir, `round-${round}`);
  writeFileSync(join(barrier, id), "");
  // Spins: sleeping between polls spreads the opens enough to miss the race in most runs
  // without the fix, where spinning caught it in every run (task 001-207).
  while (readdirSync(barrier).length < Number(parties)) {}
  const started = Date.now();
  try {
    const store = openStore(join(baseDir, String(round % half), ".git"), { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    store.close();
  } catch (error) {
    failures.push({ round, error: `${String(error)} after ${Date.now() - started} ms` });
  }
}
console.log(JSON.stringify({ id, failures }));
