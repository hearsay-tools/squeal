/*
 * Task 001-362 probe: how long the store's write lock stays free between
 * the busy-store test's two long writers. Two copies of `long-writer.ts`'s
 * loop in child processes print when each took and released the lock; the
 * parent prints every gap, the time from one writer's commit to the other's
 * next hold, which is all a waiter in SQLite's busy handler can use. Run as
 * `node --import tsx gaps.ts <dir> <holdMs> <restMs> <holds>`. Touches only `<dir>`.
 */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";

const [dir, hold, rest, holds, child] = process.argv.slice(2);
if (dir === undefined || hold === undefined || rest === undefined || holds === undefined) {
  throw new Error("usage: gaps.ts <dir> <holdMs> <restMs> <holds>");
}
const database = join(dir, "gaps.sqlite");

if (child !== undefined) {
  // As long-writer.ts, with timestamps.
  const db = new DatabaseSync(database);
  db.exec("PRAGMA busy_timeout = 0");
  for (;;) {
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch {
      await sleep(250);
      continue;
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('long-writer', ?)").run(child);
    process.stdout.write(`${child} took ${performance.timeOrigin + performance.now()}\n`);
    await sleep(Number(hold));
    db.exec("COMMIT");
    process.stdout.write(`${child} released ${performance.timeOrigin + performance.now()}\n`);
    await sleep(Number(rest));
  }
}

const setup = new DatabaseSync(database);
setup.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
setup.close();
const events: { who: string; what: string; at: number }[] = [];
const kids = ["a", "b"].map((name) => {
  const kid = spawn(process.execPath, [...process.execArgv, process.argv[1] as string, dir, hold, rest, holds, name], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  kid.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    for (const line of chunk.trim().split("\n")) {
      const [who, what, at] = line.split(" ");
      events.push({ who: who as string, what: what as string, at: Number(at) });
    }
  });
  return kid;
});
while (events.filter((e) => e.what === "took").length < Number(holds)) await sleep(100);
for (const kid of kids) kid.kill("SIGKILL");
events.sort((x, y) => x.at - y.at);
const gaps: number[] = [];
for (let i = 1; i < events.length; i++) {
  const [before, after] = [events[i - 1], events[i]];
  if (before?.what === "released" && after?.what === "took") gaps.push(after.at - before.at);
}
console.log(`in order (ms): ${gaps.map((g) => g.toFixed(0)).join(" ")}`);
gaps.sort((x, y) => x - y);
const at = (q: number) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))]?.toFixed(1);
console.log(`${gaps.length} gaps (ms): min ${at(0)} p10 ${at(0.1)} p50 ${at(0.5)} p90 ${at(0.9)} max ${at(1)}`);
console.log(`under 10 ms: ${gaps.filter((g) => g < 10).length}; under 25 ms: ${gaps.filter((g) => g < 25).length}`);
