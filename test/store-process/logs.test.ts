import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { storeProcessLogPath } from "../../src/core/store-process/paths.js";
import { withWriteKind } from "../../src/core/store-process/relay.js";
import { spawnStoreProcess } from "../../src/core/store-process/spawn.js";
import { WriteStats } from "../../src/core/store-process/stats.js";
import {
  alive,
  type Clone,
  clone,
  LAUNCH,
  openThrough,
  relay,
  storeProcess,
  until,
  warm,
} from "./helpers.js";

/*
 * Spec 021 D22.6 (row 021-36): the week's measurement reads logs. The store
 * process logs a line a minute while it wrote, and one at its exit with
 * why, per kind: batches written and failed, queue wait p50 and max, busy
 * time; in its own bounded log. The daemon logs, at the same cadence, its
 * batches through the store process and those it wrote itself, by why.
 */

const clones: Clone[] = [];
afterEach(async () => {
  for (const at of clones.splice(0)) await at.cleanup();
});
const fresh = () => {
  const at = clone();
  clones.push(at);
  return at;
};

const STORE_LINE =
  /edit: \d+ written, 0 failed, queue wait p50 \d+ ms max \d+ ms, busy \d+ ms; record: \d+ written, 0 failed/;

describe("the store process's and the daemon's lines (row 021-36, D22.6)", () => {
  it("counts per kind, with the queue wait's p50 and max", () => {
    const stats = new WriteStats();
    for (const wait of [1, 2, 30]) stats.record("edit", true, wait, 5);
    stats.record("prune", false, 7, 1);
    expect(stats.take()).toBe(
      "edit: 3 written, 0 failed, queue wait p50 2 ms max 30 ms, busy 15 ms; " +
        "prune: 0 written, 1 failed, queue wait p50 7 ms max 7 ms, busy 1 ms",
    );
    expect(stats.take()).toBeNull();
  });

  it("logs both sides' lines while batches go through the store process", async () => {
    const at = fresh();
    const running = await storeProcess(at, { reportMs: 200 });
    const lines: string[] = [];
    const one = relay(at, "w1", { log: (line) => lines.push(line), reportMs: 100 });
    const store = openThrough(at, one);
    await warm(one, store);
    lines.length = 0;

    withWriteKind("edit", () => store.meta.set("e", "1"));
    store.meta.set("r", "1");

    await until(() => STORE_LINE.test(running.stderr()), 10_000);
    expect(running.stderr()).toMatch(/store process: last minute: edit: /);
    await until(() => lines.length > 0, 5_000);
    expect(lines[0]).toBe(
      "code store: last minute: 2 batches through the store process, 0 written here " +
        "(none running 0, timeout 0, refused schema 0, failed 0, lost 0), 0 failed",
    );

    expect(await running.stop()).toBe("stopped");
    expect(running.stderr()).toMatch(/store process: stopping \(stopped\): /);
  });

  it("logs the daemon's direct writes by why: none running", async () => {
    const at = fresh();
    const lines: string[] = [];
    const one = relay(at, "w1", { log: (line) => lines.push(line), reportMs: 100 });
    const store = openThrough(at, one);
    store.meta.set("a", "1");
    store.meta.set("b", "1");

    await until(() => lines.length > 0, 5_000);
    expect(lines[0]).toBe(
      "code store: last minute: 0 batches through the store process, 2 written here " +
        "(none running 2, timeout 0, refused schema 0, failed 0, lost 0), 0 failed",
    );
  });

  it("writes the store process's lines to its own log file when a daemon starts it", async () => {
    const at = fresh();
    const pid = spawnStoreProcess(at.commonDir, LAUNCH, at.env);
    expect(pid).not.toBeNull();
    const log = storeProcessLogPath(at.commonDir, "code");
    const read = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
    at.later(async () => {
      if (pid !== null && alive(pid)) process.kill(pid, "SIGKILL");
    });
    await until(() => /store process: serving /.test(read()), 30_000);

    process.kill(pid as number, "SIGTERM");
    await until(() => !alive(pid as number), 10_000);
    expect(read()).toMatch(
      /^\S+Z \[\d+\] store process: stopping \(stopped\): no batches since the last line$/m,
    );
  }, 60_000);
});
