import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRecorded } from "../../../src/core/ci/inputs.js";
import { fill, run, temp } from "./ci-evidence-kit.js";

/*
 * Row 018-29: the records' worker maps coverage on a thread of its own in
 * the Vitest process. Its busy time is Squeal's: `map-client.cjs` adds it to
 * the process's clock (`clock.cjs`) when it closes the worker. The worker's
 * own clock is in that busy time, so the cost counts it once (review of
 * 0.1.428, B2).
 */

const load = createRequire(import.meta.url);
const clock = load("../../../src/runners/vitest/ci-runtime/clock.cjs") as {
  spent(): number;
};
const mapClient = load.resolve("../../../src/runners/vitest/ci-runtime/map-client.cjs");
const { startMapper } = load(mapClient) as {
  startMapper(
    settings: { worker: { script: string } },
    failed: (error: unknown) => void,
  ): { map(job: object): Promise<unknown>; close(): Promise<void> };
};

/** A worker that is busy for `ms` on each job, calling `call` all along, then answers an empty record. */
const BUSY = (ms: number, call = "") => `import { parentPort } from "node:worker_threads";
import { statSync } from "node:fs";
parentPort.on("message", ({ id }) => {
  const until = performance.now() + ${ms};
  while (performance.now() < until) ${call};
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

  it("counts the worker's time once when its own evidence is on its clock too", () => {
    const WORK_MS = 300;
    const root = join(temp(), "root");
    fill(root, {
      "data/a.txt": "a",
      // Its whole job is evidence calls: the worker's own clock holds most of the job.
      "busy.mjs": BUSY(WORK_MS, `statSync("data/a.txt")`),
      "script.mjs": `import { createRequire } from "node:module";
const { startMapper } = createRequire(import.meta.url)(${JSON.stringify(mapClient)});
const script = new URL("./busy.mjs", import.meta.url).pathname;
const mapper = startMapper({ worker: { script } }, (error) => { throw error; });
await mapper.map({ testFile: { project: "", path: "a.test.ts" }, payload: {}, sources: 0, source: () => null });
await mapper.close();
`,
    });
    const evidence = temp();
    run(root, { evidence });
    const { hooks } = readRecorded(evidence);
    // The process and its worker, each with a clock.
    expect(hooks.threads).toBe(2);
    expect(hooks.ms).toBeGreaterThanOrEqual(WORK_MS);
    // Counted twice, it is near twice the job: the worker's clock and its busy time.
    expect(hooks.ms).toBeLessThan(1.4 * WORK_MS);
  });
});
