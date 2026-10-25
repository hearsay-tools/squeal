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
import { type PayloadSet, payloads, TS_WORKER } from "./payloads.js";

/*
 * 011-197's recommendation 2 (row 015-42): while the records' writer
 * stores payloads that take 200 ms or more each, a reconciliation pass of
 * the change feed finishes within 3x its time with no writer. On 0.1.301
 * each payload held one turn of the event loop, so a pass took about its
 * turns x 200 ms. Timing is asserted only on a machine loaded no more than
 * the other timing tests allow.
 */

const MAX_LOAD_FOR_TIMING = 8;
const TRACKED = 2_000;
const PAYLOAD_MS = 200;
const PAYLOADS = 12;

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

/** The main thread's time to parse and map one payload of `set`. */
function mapMs(set: PayloadSet): number {
  const file: CoveredFile = set.file();
  const began = performance.now();
  const scripts = JSON.parse(readFileSync(file.payload, "utf8")).result;
  encodeRecord(buildRecord(file, scripts, "sha1", new Map()));
  return performance.now() - began;
}

/** Payloads that take `PAYLOAD_MS` or more each to map on this machine now. */
function heavy(): { set: PayloadSet; ms: number } {
  for (let lines = 200; ; lines *= 2) {
    const made = payloads(300, lines);
    const ms = mapMs(made);
    if (ms >= PAYLOAD_MS || lines >= 3_200) return { set: made, ms };
    made.cleanup();
  }
}

describe("the change feed beside the records' writer (011-197, row 015-42)", () => {
  it(`reconciles ${TRACKED} tracked paths within 3x its time while payloads are stored`, async (ctx) => {
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
    writer.collected({ runId: "run-1", files });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const beside = await pass();
    const busy = writer.busy();
    await writer.idle();
    await writer.close();
    expect(errors).toEqual([]);

    const load = loadavg()[0] ?? 0;
    const text = `reconciliation pass over ${TRACKED} tracked paths: ${Math.round(alone)} ms alone, ${Math.round(beside)} ms beside ${PAYLOADS} payloads of ${Math.round(made.ms)} ms each; load average ${load.toFixed(1)}`;
    console.log(text);
    if (load > MAX_LOAD_FOR_TIMING)
      ctx.skip(`load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; ${text}`);
    // The pass ran while the writer had payloads in hand.
    expect(busy).toBe(true);
    expect(made.ms).toBeGreaterThanOrEqual(PAYLOAD_MS);
    expect(beside).toBeLessThan(3 * alone);
  }, 180_000);
});
