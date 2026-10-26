import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRecord,
  type CoveredFile,
  createCoverageWriter,
  encodeRecord,
} from "../../../src/core/code/coverage/index.js";
import { type ChangeFeed, createChangeFeed } from "../../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../../src/core/watcher/index.js";
import { git, makeRepo } from "../../watcher/helpers.js";
import { commonDir, ON } from "../helpers.js";
import { TurnLog } from "../pass/turns.js";
import { type PayloadSet, payloads, TS_WORKER } from "./payloads.js";

/*
 * 011-197's recommendation 2 (row 015-42): while the records' writer
 * stores payloads that take 200 ms or more each, a reconciliation pass of
 * the change feed runs beside them. On 0.1.301 each payload held one turn
 * of the event loop, so a pass took about its turns x 200 ms. Row 015-60:
 * a bound of 3x the pass's time alone failed once on CI at 3.1x, and a
 * payload mapped on the main thread and paced passes it. So the test
 * bounds the main thread's CPU time in its longest turn while the payloads
 * are stored, as `chain-load.test.ts` does on CI, and logs the pass's wall
 * time. Timing is asserted only on a machine loaded no more than the other
 * timing tests allow.
 */

const MAX_LOAD_FOR_TIMING = 8;
const TRACKED = 2_000;
const PAYLOAD_MS = 200;
const PAYLOADS = 12;
/**
 * The share of one payload's map time on the main thread that one turn may
 * hold while payloads are stored. A payload mapped there holds a turn of
 * about three quarters of it; with the worker, no turn held a sixth (row
 * 015-60's notes).
 */
const TURN_SHARE = 0.5;

let cleanup = () => {};
let feed: ChangeFeed | null = null;
let set: PayloadSet | null = null;
afterEach(async () => {
  await feed?.close();
  feed = null;
  cleanup();
  set?.cleanup();
  set = null;
});

/** The main thread's wall and CPU time, in ms, to parse and map one payload of `set`. */
function mapTime(set: PayloadSet): { ms: number; cpu: number } {
  const file: CoveredFile = set.file();
  const began = performance.now();
  const cpu = process.threadCpuUsage();
  const scripts = JSON.parse(readFileSync(file.payload, "utf8")).result;
  encodeRecord(buildRecord(file, scripts, "sha1", new Map()));
  const used = process.threadCpuUsage(cpu);
  return { ms: performance.now() - began, cpu: (used.user + used.system) / 1000 };
}

/** Payloads that take `PAYLOAD_MS` or more each to map on this machine now. */
function heavy(): { set: PayloadSet; ms: number; cpu: number } {
  for (let lines = 200; ; lines *= 2) {
    const made = payloads(300, lines);
    const time = mapTime(made);
    if (time.ms >= PAYLOAD_MS || lines >= 3_200) return { set: made, ...time };
    made.cleanup();
  }
}

describe("the change feed beside the records' writer (011-197, rows 015-42 and 015-60)", () => {
  it(`reconciles ${TRACKED} tracked paths while payloads are stored, with no payload mapped in a main-thread turn`, async (ctx) => {
    const repo = makeRepo();
    cleanup = repo.cleanup;
    const tracked: string[] = [];
    for (let d = 0; d < TRACKED / 100; d++) {
      mkdirSync(join(repo.root, "src", `d${d}`), { recursive: true });
      for (let f = 0; f < 100; f++) {
        const path = `src/d${d}/f${f}.ts`;
        writeFileSync(join(repo.root, path), `export const v = ${f};\n`);
        tracked.push(path);
      }
    }
    git(repo.root, "add", ".");
    git(repo.root, "commit", "-q", "-m", "tracked paths");
    const errors: Error[] = [];
    feed = createChangeFeed({
      root: repo.root,
      backend: createWatcherBackend("linux"),
      onBatch: () => {},
      onError: (error) => errors.push(error),
      trackedPaths: () => tracked,
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
    const pass = async () => {
      const began = performance.now();
      await feed?.reconcile("interval");
      return performance.now() - began;
    };
    const alone = Math.min(await pass(), await pass(), await pass());

    const made = heavy();
    set = made.set;
    const writer = createCoverageWriter({
      commonDir: commonDir(),
      format: "sha1",
      policy: () => ON,
      resultKey: (_run, testFile) => `key-${testFile.path}`,
      log: () => {},
      worker: TS_WORKER,
    });
    const files = Array.from({ length: PAYLOADS }, (_, i) => made.set.file(`test/t${i}.test.ts`));
    const turns = new TurnLog();
    turns.start("storing payloads");
    writer.collected({ runId: "run-1", files });
    await new Promise((resolve) => setTimeout(resolve, 20));
    turns.mark("the pass");
    const beside = await pass();
    turns.mark("storing payloads");
    const busy = writer.busy();
    await writer.idle();
    turns.stop();
    await writer.close();
    expect(errors).toEqual([]);

    const work = turns.longestWork();
    const bound = TURN_SHARE * made.cpu;
    const load = loadavg()[0] ?? 0;
    const text = `reconciliation pass over ${TRACKED} tracked paths: ${Math.round(alone)} ms alone, ${Math.round(beside)} ms beside ${PAYLOADS} payloads of ${Math.round(made.ms)} ms each (thread ${Math.round(made.cpu)} ms); most work in a turn ${work} ms, bound ${Math.round(bound)} ms; load average ${load.toFixed(1)}; ${turns.summary()}`;
    console.log(text);
    if (load > MAX_LOAD_FOR_TIMING)
      ctx.skip(`load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; ${text}`);
    // The pass ran while the writer had payloads in hand.
    expect(busy).toBe(true);
    expect(made.ms).toBeGreaterThanOrEqual(PAYLOAD_MS);
    expect(work).toBeLessThan(bound);
  }, 180_000);
});
