import { describe, expect, it } from "vitest";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/** The `observed` fixture: runtime.test.ts reads, spawns, starts a Worker and lists (task 001-132). */
const observing = (root: string) => createVitestAdapter({ root, observe: () => true });

const RUNTIME_READS = [
  "data/grand.txt",
  "data/input.txt",
  "data/worker.txt",
  "scripts/child.mjs",
  "scripts/grandchild.mjs",
  "scripts/worker.mjs",
];

describe("vitest adapter: observed runtime inputs", SLOW, () => {
  it.each(["forks", "threads"])(
    "under %s, sees the data file, an env {} child and grandchild, a Worker and a listing",
    async (pool) => {
      const fx = await openFixture("observed", {}, observing);
      const runtime = ref("test/runtime.test.ts", pool);
      const plain = ref("test/plain.test.ts", pool);
      const report = await fx.adapter.run([runtime, plain], fx.runOptions());

      expect(report.end).toBe("completed");
      expect(report.results.every((r) => r.outcome === "pass")).toBe(true);
      const seen = report.observed?.find((o) => o.testFile.path === runtime.path);
      expect(seen?.testFile).toEqual(runtime);
      for (const path of RUNTIME_READS) expect(seen?.paths).toContain(path);
      expect(seen?.directories).toEqual(["data/listed"]);
      const other = report.observed?.find((o) => o.testFile.path === plain.path);
      for (const path of RUNTIME_READS) expect(other?.paths ?? []).not.toContain(path);
    },
  );

  it("observes nothing while observation is off, and changes no environment", async () => {
    const off = await openFixture("observed");
    const report = await off.adapter.run([ref("test/runtime.test.ts", "forks")], off.runOptions());
    expect(report.end).toBe("completed");
    expect(report.observed).toBeUndefined();
    const [environment] = await off.adapter.environment();
    expect(environment?.adapterVersion).toBe(off.adapter.adapterVersion);

    const on = await openFixture("observed", {}, observing);
    const [observed] = await on.adapter.environment();
    expect(observed?.adapterVersion).not.toBe(environment?.adapterVersion);
    expect(observed?.resolvedConfig).toBe(environment?.resolvedConfig);
  });

  it("follows the policy: switching it on recreates the instance with the recorder", async () => {
    let enabled = false;
    const fx = await openFixture("observed", {}, (root) =>
      createVitestAdapter({ root, observe: () => enabled }),
    );
    const runtime = ref("test/runtime.test.ts", "forks");
    expect((await fx.adapter.run([runtime], fx.runOptions())).observed).toBeUndefined();
    enabled = true;
    const report = await fx.adapter.run([runtime], fx.runOptions());
    expect(report.observed?.[0]?.paths).toContain("data/input.txt");
  });
});
