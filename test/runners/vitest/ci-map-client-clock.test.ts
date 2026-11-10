import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { temp } from "./ci-evidence-kit.js";

/*
 * Row 018-29: the records' worker maps coverage on a thread of its own in
 * the Vitest process. Its busy time is Squeal's: `map-client.cjs` adds it to
 * the process's clock (`clock.cjs`) when it closes the worker.
 */

const load = createRequire(import.meta.url);
const clock = load("../../../src/runners/vitest/ci-runtime/clock.cjs") as {
  spent(): number;
};
const { startMapper } = load("../../../src/runners/vitest/ci-runtime/map-client.cjs") as {
  startMapper(
    settings: { worker: { script: string } },
    failed: (error: unknown) => void,
  ): { map(job: object): Promise<unknown>; close(): Promise<void> };
};

/** A worker that is busy for `ms` on each job, then answers an empty record. */
const BUSY = (ms: number) => `import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ id }) => {
  const until = performance.now() + ${ms};
  while (performance.now() < until);
  parentPort.postMessage({ type: "record", id, record: { paths: [], parts: [], unread: [] } });
});
`;

describe("the records' worker on the clock (row 018-29)", () => {
  it("adds the worker's busy time to the process's clock when it closes", async () => {
    const script = join(temp(), "busy.mjs");
    writeFileSync(script, BUSY(60));
    const failures: unknown[] = [];
    const mapper = startMapper({ worker: { script } }, (error) => failures.push(error));
    const job = { testFile: { project: "", path: "a.test.ts" }, payload: {}, sources: 0 };
    await mapper.map({ ...job, source: () => null });
    await mapper.map({ ...job, source: () => null });
    const before = clock.spent();
    await mapper.close();
    expect(failures).toEqual([]);
    // Two jobs of 60 ms each; this thread's own waits are not on the clock.
    expect(clock.spent() - before).toBeGreaterThanOrEqual(110);
  });
});
