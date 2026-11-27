import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoverageWriter } from "../../../src/core/code/coverage/writer.js";
import { createWatcherBackend } from "../../../src/core/watcher/backend.js";
import { type ChangeFeed, createChangeFeed } from "../../../src/core/watcher/change-feed.js";
import { git, makeRepo } from "../../watcher/helpers.js";
import { commonDir, ON } from "../helpers.js";
import { type PayloadSet, payloads, TS_WORKER } from "./payloads.js";

/*
 * 011-197's recommendation 2 (row 015-42): while the records' writer
 * stores payloads, a reconciliation pass of the change feed runs beside
 * them. On 0.1.301 each payload was parsed and mapped in one turn of the
 * event loop, so a pass took about its turns x 200 ms.
 *
 * Row 011-429 (G1): the test counts the main thread's parses of a payload
 * while the pass runs beside the writer, not the CPU time of its longest
 * turn: that bound (half a payload's map time, row 015-60) is a time on a
 * shared CI runner, like `writer-turns.test.ts`'s, which failed there at
 * 103 to 320 ms against 100. With the worker, the main thread parses no
 * payload; `writer-turns.test.ts` shows the count is one without it. The
 * pass's time alone and beside the writer, and the longest turn, stay in
 * the log; their figure is the `bench/` cells' `hook.writeWait.max`.
 */

const TRACKED = 2_000;
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
  vi.restoreAllMocks();
});

describe("the change feed beside the records' writer (011-197, rows 015-42 and 015-60)", () => {
  it(`reconciles ${TRACKED} tracked paths while payloads are stored, with no payload parsed on the main thread`, async () => {
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

    const own = payloads(100, 300);
    set = own;
    const parse = vi.spyOn(JSON, "parse");
    const logged: string[] = [];
    const writer = createCoverageWriter({
      commonDir: commonDir(),
      format: "sha1",
      policy: () => ON,
      resultKey: (_run, testFile) => `key-${testFile.path}`,
      log: (line) => logged.push(line),
      worker: TS_WORKER,
    });
    const files = Array.from({ length: PAYLOADS }, (_, i) => own.file(`test/t${i}.test.ts`));
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    writer.collected({ runId: "run-1", files });
    // The pass starts with the writer's payloads in hand: a host's speed cannot change that order.
    const busy = writer.busy();
    const beside = await pass();
    await writer.idle();
    delay.disable();
    await writer.close();
    expect(errors).toEqual([]);

    const large = parse.mock.calls.filter(
      ([text]) => typeof text === "string" && text.length >= own.bytes / 2,
    ).length;
    const load = loadavg()[0] ?? 0;
    console.log(
      `reconciliation pass over ${TRACKED} tracked paths: ${Math.round(alone)} ms alone, ${Math.round(beside)} ms beside ${PAYLOADS} payloads of ${(own.bytes / 2 ** 20).toFixed(1)} MiB; longest turn ${Math.round(delay.max / 1e6)} ms; load average ${load.toFixed(1)}`,
    );
    // No payload was parsed on this thread while the pass ran beside the writer.
    expect(busy).toBe(true);
    expect(logged.filter((line) => line.includes("mapping on the main thread"))).toEqual([]);
    expect(large).toBe(0);
  }, 180_000);
});
