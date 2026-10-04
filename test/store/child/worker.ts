/*
 * Child process for the store concurrency and crash tests. Run through
 * `spawnWorker` in `spawn.ts`. Prints one JSON line on success.
 *
 *   writer <commonDir> <id> <transactions> <rowsPerTx>
 *   reader <commonDir> <id>          (until <commonDir>/stop exists)
 *   crasher <commonDir> <rowsPerTx>  (until killed; prints "committed <n>")
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/index.js";
import type { ResultRecord, Store } from "../../../src/core/types/index.js";

const [mode, commonDir, ...rest] = process.argv.slice(2);
if (!mode || !commonDir) throw new Error("usage: worker <mode> <commonDir> ...");

const opened = openStore(commonDir, { busyTimeoutMs: 60_000 });
if (isStoreOpenFailure(opened)) throw new Error(`open failed: ${JSON.stringify(opened)}`);
const store: Store = opened;

function rows(prefix: string, key: string, count: number): ResultRecord[] {
  return Array.from({ length: count }, (_, j) => ({
    check: { kind: "test", project: "", testPath: `${prefix}.test.ts`, fullName: `case ${j}` },
    key,
    outcome: j % 7 === 0 ? "fail" : "pass",
    durationMs: j,
    location: null,
    fingerprint: j % 7 === 0 ? `Error: ${prefix} ${j}` : null,
    summary: j % 7 === 0 ? `failure ${j}` : null,
    errors: [],
    provenance: {
      worktreeId: prefix,
      revision: 1,
      commit: null,
      dirty: false,
      runId: key,
      recordedAt: Date.now(),
    },
  }));
}

function counter(): number {
  return Number(store.meta.get("counter") ?? "0");
}

if (mode === "writer") {
  const [id = "w", txs = "100", perTx = "50"] = rest;
  for (let i = 0; i < Number(txs); i++) {
    store.transaction(() => {
      // Read-modify-write: only serializable write transactions keep every increment.
      store.meta.set("counter", String(counter() + 1));
      store.results.putMany(rows(`writer-${id}`, `writer-${id}-tx-${i}`, Number(perTx)));
    });
  }
  console.log(JSON.stringify({ mode, id, transactions: Number(txs) }));
} else if (mode === "reader") {
  const [id = "r"] = rest;
  const stopFile = join(commonDir, "stop");
  let reads = 0;
  let last = 0;
  let regressions = 0;
  let partialTransactions = 0;
  const deadline = Date.now() + 120_000;
  // Tell the test we are open and looping, so writers start only once readers run alongside them.
  console.log("ready");
  do {
    const now = counter();
    if (now < last) regressions++;
    last = now;
    if (now > 0) {
      // Writer 0's transactions commit in order; a visible one must be whole.
      const seen = store.results.byKey(`writer-0-tx-${Math.floor(Math.random() * 10)}`);
      if (seen.length !== 0 && seen.length !== 50) partialTransactions++;
    }
    reads++;
  } while (!existsSync(stopFile) && Date.now() < deadline);
  console.log(JSON.stringify({ mode, id, reads, regressions, partialTransactions, last }));
} else if (mode === "crasher") {
  const [perTx = "50"] = rest;
  for (let i = 0; ; i++) {
    store.transaction(() => {
      store.results.putMany(rows("crasher", `crash-tx-${process.pid}-${i}`, Number(perTx)));
      store.meta.set("crash-last", String(i));
    });
    if (i % 10 === 0) console.log(`committed ${i}`);
  }
} else {
  throw new Error(`unknown mode ${mode}`);
}

store.close();
