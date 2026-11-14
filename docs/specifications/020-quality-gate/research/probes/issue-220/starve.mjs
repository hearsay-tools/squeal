// Throwaway #220 probe: how often a waiter with the keeper's busy slice
// (20 ms early, 250 ms last pass) and `busyBackoffMs` pauses gets the write
// lock against `holder.mjs`. Scratch file under $TMPDIR; no Squeal store.
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const BACKOFF = [0, 100, 250];
async function trial(holdMs, gapMs, sliceMs, forMs) {
  const dir = mkdtempSync(join(tmpdir(), "issue-220-"));
  const file = join(dir, "s.sqlite");
  const setup = new DatabaseSync(file);
  setup.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(v)");
  setup.close();
  const child = fork(new URL("./holder.mjs", import.meta.url), [file, holdMs, gapMs, forMs + 1000]);
  await new Promise((r) => child.once("message", r));
  await sleep(200);
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=${sliceMs}`);
  const start = Date.now();
  let landed = 0, refused = 0, longest = 0, since = Date.now(), streak = 0;
  while (Date.now() - start < forMs) {
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("INSERT INTO t(v) VALUES (-1)");
      db.exec("COMMIT");
      landed++;
      longest = Math.max(longest, Date.now() - since);
      since = Date.now();
      streak = 0;
      await sleep(20); // the keeper's next file: its inputs read, its records built
    } catch (e) {
      if (!String(e.message).includes("locked") && !String(e.message).includes("busy")) throw e;
      refused++;
      await sleep(BACKOFF[Math.min(streak++, 2)]);
    }
  }
  longest = Math.max(longest, Date.now() - since);
  db.close();
  child.kill();
  await new Promise((r) => child.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
  return { holdMs, gapMs, sliceMs, forMs, landed, refused, longestNoWriteMs: longest };
}
const out = [];
const cases = [
  [50, 0], [50, 50], [250, 0], [250, 250],
];
for (const [holdMs, gapMs] of cases)
  for (const sliceMs of [20, 250]) {
    const load = loadavg()[0].toFixed(2);
    const r = await trial(holdMs, gapMs, sliceMs, 8000);
    out.push({ ...r, load1Before: Number(load) });
    console.log(JSON.stringify(out.at(-1)));
  }
