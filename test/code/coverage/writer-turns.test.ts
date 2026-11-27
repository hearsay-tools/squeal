import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapWorker } from "../../../src/core/code/coverage/mapper.js";
import { createCoverageWriter } from "../../../src/core/code/coverage/writer.js";
import { commonDir, ON } from "../helpers.js";
import { type PayloadSet, payloads, TS_WORKER } from "./payloads.js";

/*
 * Row 015-42 (011-197): the records' writer parses and maps a payload off
 * the main thread, so a large one holds no turn of the daemon's event loop
 * for long. 011-197 saw turns of about 8 s.
 *
 * Row 011-429 (G1): the test counts the work the main thread does, not the
 * time it takes. The payload's parse is the turn 011-197 saw; with the
 * worker, the main thread never parses a text the payload's size. A turn's
 * CPU time against this run's own parse (row 011-376) failed on CI at 103
 * to 320 ms against a bound of 100: the collector's garbage and a
 * shared runner's other workers land inside the window. Without the worker
 * the same count is one, so the check tells the two apart. The writer's
 * speed is the `bench/` coverage cells' figure.
 */

let set: PayloadSet | null = null;
afterEach(() => {
  set?.cleanup();
  set = null;
  vi.restoreAllMocks();
});

/** Stores one payload through a writer with `worker`; the main thread's parses of a text half its size or more, and the log. */
async function store(worker: MapWorker | null) {
  const own = payloads(100, 300);
  set = own;
  const parse = vi.spyOn(JSON, "parse");
  const logged: string[] = [];
  let stored = 0;
  const writer = createCoverageWriter({
    commonDir: commonDir(),
    format: "sha1",
    policy: () => ON,
    resultKey: (_run, testFile) => `key-${testFile.path}`,
    log: (line) => logged.push(line),
    onStored: () => stored++,
    worker,
  });
  try {
    writer.collected({ runId: "run-1", files: [own.file("test/a.test.ts")] });
    await writer.idle();
  } finally {
    await writer.close();
  }
  const large = parse.mock.calls.filter(
    ([text]) => typeof text === "string" && text.length >= own.bytes / 2,
  ).length;
  return { stored, large, logged };
}

describe("the records' writer's turns (row 015-42)", () => {
  it("parses a large payload in its worker, never on the main thread", async () => {
    const { stored, large, logged } = await store(TS_WORKER);
    expect(stored).toBe(1);
    expect(logged.filter((line) => line.includes("mapping on the main thread"))).toEqual([]);
    expect(large).toBe(0);
  }, 60_000);

  it("parses it on the main thread without a worker, so the count above tells the two apart", async () => {
    const { stored, large } = await store(null);
    expect(stored).toBe(1);
    expect(large).toBe(1);
  }, 60_000);
});
