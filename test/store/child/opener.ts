/*
 * Child process for the concurrent-open smoke test. Run through `spawnChild`
 * in `spawn.ts`.
 *
 *   opener <baseDir> <rounds> <deadlineMs>
 *
 * Round `r` opens the store under `<baseDir>/<r mod (rounds/2)>/.git`: the
 * first half of the rounds create the stores, the second half reopen them.
 * Before each round it prints `ready <r>` and blocks on a line from stdin,
 * which the test writes once every party is ready, so the opens overlap; no
 * line within `deadlineMs` exits 2 (review wave-13r S1). Prints one JSON
 * line: the rounds whose open threw, with the error.
 */
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/index.js";

const [baseDir, rounds = "4", deadlineMs = "20000"] = process.argv.slice(2);
if (!baseDir) throw new Error("usage: opener <baseDir> <rounds> <deadlineMs>");

const input = createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();

/** The next line from stdin, or exit 2 past the deadline. */
async function go(round: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>(() => {
    timer = setTimeout(() => {
      process.stderr.write(`no go for round ${round} within ${deadlineMs} ms\n`);
      process.exit(2);
    }, Number(deadlineMs));
  });
  try {
    const line = await Promise.race([lines.next(), late]);
    if (line.done === true) throw new Error(`stdin closed before round ${round}`);
  } finally {
    clearTimeout(timer);
  }
}

const half = Number(rounds) / 2;
const failures: { round: number; error: string }[] = [];
for (let round = 0; round < Number(rounds); round++) {
  console.log(`ready ${round}`);
  await go(round);
  const started = Date.now();
  try {
    const store = openStore(join(baseDir, String(round % half), ".git"), { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    store.close();
  } catch (error) {
    failures.push({ round, error: `${String(error)} after ${Date.now() - started} ms` });
  }
}
console.log(JSON.stringify({ failures }));
input.close();
