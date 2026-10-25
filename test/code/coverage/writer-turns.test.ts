import { loadavg } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { createCoverageWriter } from "../../../src/core/code/coverage/index.js";
import { commonDir, ON } from "../helpers.js";
import { type PayloadSet, payloads, TS_WORKER } from "./payloads.js";

/*
 * Row 015-42 (011-197): the records' writer parses and maps a payload off
 * the main thread, so a large one holds no turn of the daemon's event loop
 * for long. 011-197 saw turns of about 8 s. Timing is asserted only on a
 * machine loaded no more than the other timing tests allow.
 */

const MAX_LOAD_FOR_TIMING = 8;
const TURN_BUDGET_MS = 100;

let set: PayloadSet | null = null;
afterEach(() => {
  set?.cleanup();
  set = null;
});

describe("the records' writer's turns (row 015-42)", () => {
  it("keeps the main thread's longest turn short while a large payload is stored", async (ctx) => {
    const own = payloads(300, 600);
    set = own;
    let stored = 0;
    const writer = createCoverageWriter({
      commonDir: commonDir(),
      format: "sha1",
      policy: () => ON,
      resultKey: (_run, testFile) => `key-${testFile.path}`,
      log: () => {},
      onStored: () => stored++,
      worker: TS_WORKER,
    });
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    // The probe times a turn from its tick before it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const began = performance.now();
    writer.collected({ runId: "run-1", files: [own.file("test/a.test.ts")] });
    await writer.idle();
    const took = Math.round(performance.now() - began);
    // The probe counts a turn once it ticks after it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    delay.disable();
    await writer.close();
    expect(stored).toBe(1);

    const longest = Math.round(delay.max / 1e6);
    const load = loadavg()[0] ?? 0;
    console.log(
      `coverage writer: a ${(own.bytes / 2 ** 20).toFixed(1)} MiB payload stored in ${took} ms; longest turn ${longest} ms; load average ${load.toFixed(1)}`,
    );
    if (load > MAX_LOAD_FOR_TIMING) {
      ctx.skip(
        `load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; longest turn ${longest} ms`,
      );
    }
    expect(longest).toBeLessThan(TURN_BUDGET_MS);
  }, 120_000);
});
