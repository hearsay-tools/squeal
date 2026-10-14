import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_BUSY_TIMEOUT_MS } from "../../../src/core/store/index.js";
import { tempDir } from "../../store/helpers.js";
import { runNode } from "../bundle-helpers.js";

/*
 * Spec 009 D4 as amended by review wave 0, S2: a worker blocked inside a
 * native call, a SQLite busy wait on a store another process holds, cannot
 * be terminated. The handler is silent at its deadline all the same, and
 * the process exits once the busy wait returns: within the store's busy
 * timeout after the deadline, never later.
 */

const HOST_MODULE = resolve(import.meta.dirname, "../../../src/harness/pi/host.ts");
const DEADLINE_MS = 300;

/**
 * A process with one host whose worker, on its first request, opens the
 * database at `db` and waits `busy` ms for its lock; the process calls once
 * against the deadline, stops the host, prints when the call returned, and
 * has nothing else to do.
 */
const CHILD = `
import { Worker } from "node:worker_threads";
const [hostModule, db, busy, deadline] = process.argv.slice(2);
const { createDeliveryHost } = await import(hostModule);
const host = createDeliveryHost(() => new Worker(
  \`const { parentPort, workerData } = require("node:worker_threads");
   const { DatabaseSync } = require("node:sqlite");
   parentPort.on("message", ({ id }) => {
     const db = new DatabaseSync(workerData.db);
     db.exec("PRAGMA busy_timeout = " + workerData.busy);
     let answer = "locked";
     try { db.exec("BEGIN EXCLUSIVE"); } catch { answer = "busy"; }
     parentPort.postMessage({ id, ok: true, answer });
   });\`,
  { eval: true, workerData: { db, busy: Number(busy) }, execArgv: ["--disable-warning=ExperimentalWarning"] },
));
const started = performance.now();
const answer = await host.call({ kind: "ping" }, Number(deadline));
const returnedAt = performance.now();
host.stop();
process.stdout.write(JSON.stringify({ answer, returnedMs: returnedAt - started, returnedAt }));
`;

describe("a worker blocked in a native call (review wave 0, S2)", () => {
  it("is silent at the handler's deadline, and the process exits within the busy timeout after it", async () => {
    const dir = tempDir("squeal-pi-native-");
    const db = join(dir, "held.sqlite");
    const script = join(dir, "child.mjs");
    writeFileSync(script, CHILD);
    const holder = new DatabaseSync(db);
    holder.exec("PRAGMA locking_mode = EXCLUSIVE");
    holder.exec("BEGIN EXCLUSIVE");
    try {
      const out = await runNode(
        [
          "--experimental-strip-types",
          "--disable-warning=ExperimentalWarning",
          script,
          HOST_MODULE,
          db,
          String(DEFAULT_BUSY_TIMEOUT_MS),
          String(DEADLINE_MS),
        ],
        "",
      );
      expect(out.code, out.stderr).toBe(0);
      const printed = JSON.parse(out.stdout) as {
        answer: unknown;
        returnedMs: number;
        returnedAt: number;
      };
      expect(printed.answer).toBeNull();
      expect(printed.returnedMs).toBeGreaterThanOrEqual(DEADLINE_MS - 5);
      expect(printed.returnedMs).toBeLessThan(DEADLINE_MS + 500);
      // The exit waits for the busy wait, which started before the deadline: at most its timeout.
      // The floor shows the worker was in it: an idle worker's process exits at once.
      const exitLagMs = out.ms - printed.returnedAt;
      expect(exitLagMs).toBeGreaterThan(DEFAULT_BUSY_TIMEOUT_MS - DEADLINE_MS - 200);
      expect(exitLagMs).toBeLessThan(DEFAULT_BUSY_TIMEOUT_MS + 500);
    } finally {
      holder.close();
    }
  }, 20_000);
});
