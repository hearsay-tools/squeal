// Throwaway probe (see README.md): takes the waiter lock on a fresh file while a prober polls it.
import { fork } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { acquireWaiterLock, waiterLockPath } from "../../../../../../src/core/waiter-lock/waiter-lock.js";

const [trialsText = "200", intervalText = "20", busyText] = process.argv.slice(2);
const trials = Number(trialsText);
const interval = Number(intervalText);
const busy = busyText === undefined ? null : Number(busyText);
const dir = mkdtempSync(join(tmpdir(), "idle-wake-race-"));
const locksDir = join(dir, "locks");
mkdirSync(locksDir, { recursive: true });
const consumer = { worktreeId: "w", sessionId: "s", agentId: "main" } as never;
const path = waiterLockPath(locksDir as never, consumer);

/** `lock()` of waiter-lock.ts with a busy timeout: the variant under test, not product code. */
function lockWithBusy(ms: number): DatabaseSync | null {
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${ms}`);
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch {
    db.close();
    return null;
  }
}

const prober = fork(fileURLToPath(new URL("./prober.ts", import.meta.url)), [locksDir, intervalText], {
  execArgv: ["--import", "tsx"],
});
await sleep(1500);
let lost = 0;
const ms: number[] = [];
for (let i = 0; i < trials; i++) {
  rmSync(path, { force: true });
  await sleep(Math.random() * interval);
  const t0 = performance.now();
  if (busy === null) {
    const lock = acquireWaiterLock(locksDir as never, consumer);
    ms.push(performance.now() - t0);
    if (lock === null) lost++;
    else {
      await sleep(interval * 2);
      lock.release(true);
    }
  } else {
    const db = lockWithBusy(busy);
    ms.push(performance.now() - t0);
    if (db === null) lost++;
    else {
      await sleep(interval * 2);
      db.close();
    }
  }
}
const counts = await new Promise((done) => {
  prober.once("message", done);
  prober.send("done");
});
ms.sort((a, b) => a - b);
const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]?.toFixed(3);
console.log(
  JSON.stringify({
    trials,
    intervalMs: interval,
    busyTimeoutMs: busy ?? 0,
    lost,
    acquireMs: { p50: q(0.5), p95: q(0.95), max: q(1) },
    prober: counts,
  }),
);
rmSync(dir, { recursive: true, force: true });
