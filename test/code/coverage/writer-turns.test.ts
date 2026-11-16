import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createCoverageWriter } from "../../../src/core/code/coverage/writer.js";
import { commonDir, ON } from "../helpers.js";
import { type PayloadSet, payloads, TS_WORKER } from "./payloads.js";
import { threadCpuMs, watchTurns } from "./turns.js";

/*
 * Row 015-42 (011-197): the records' writer parses and maps a payload off
 * the main thread, so a large one holds no turn of the daemon's event loop
 * for long. 011-197 saw turns of about 8 s.
 *
 * Row 011-376: a turn is judged by the main thread's CPU time in it, not by
 * its wall time. On CI a turn of 232 ms held little of the thread's own work:
 * the store write waiting on the disk, or the runner not scheduling the
 * thread. The bound is this run's own cost of parsing the same payload on the
 * main thread, so it follows the machine: the writer's longest turn must hold
 * less than `PARSE_SHARE` of it. Measured: the writer's longest turn about
 * 25 ms, the parse 190 to 290 ms, the parse and map 640 to 1,030 ms.
 */

const PARSE_SHARE = 0.5;

let set: PayloadSet | null = null;
afterEach(() => {
  set?.cleanup();
  set = null;
});

/** The main thread's CPU time, in ms, to parse `path` as the writer would without its worker. */
function parseCpuMs(path: string): number {
  const began = threadCpuMs();
  JSON.parse(readFileSync(path, "utf8"));
  return threadCpuMs() - began;
}

describe("the records' writer's turns (row 015-42)", () => {
  it("keeps the main thread's longest turn short while a large payload is stored", async () => {
    const own = payloads(300, 600);
    set = own;
    const parseMs = parseCpuMs(own.file("test/parse.test.ts").payload);
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
    const turns = watchTurns();
    // The probe times a turn from its tick before it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const began = performance.now();
    writer.collected({ runId: "run-1", files: [own.file("test/a.test.ts")] });
    await writer.idle();
    const took = Math.round(performance.now() - began);
    // The probe counts a turn once it ticks after it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const longest = turns.stop();
    await writer.close();
    expect(stored).toBe(1);

    const load = loadavg()[0] ?? 0;
    console.log(
      `coverage writer: a ${(own.bytes / 2 ** 20).toFixed(1)} MiB payload stored in ${took} ms; longest turn ${Math.round(longest.cpuMs)} ms of CPU, ${Math.round(longest.wallMs)} ms by the clock; its parse on this thread ${Math.round(parseMs)} ms of CPU; load average ${load.toFixed(1)}`,
    );
    expect(longest.cpuMs).toBeLessThan(parseMs * PARSE_SHARE);
  }, 120_000);
});
