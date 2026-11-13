import { describe, expect, it } from "vitest";
import type { RelativePath } from "../../../src/core/types/common.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 020-50 (#207): Vitest's pool does not await a stopped worker's exit
 * at the end of a run, only at its next cancel or close (Vitest 5.0.3). So
 * with a threshold the worker outlives after the run, the teardown timeout
 * line comes after the run's report, while the instance closes. The
 * adapter's `teardown` still hears it then.
 */

/** The file holds its worker's stop for 4 s; Vitest's threshold is 2 s. */
const FILES = {
  "vitest.config.ts": `export default { test: { include: ["late/**/*.test.ts"], pool: "forks", maxWorkers: 1, teardownTimeout: 2000 } };\n`,
  "late/late.test.ts": `import { expect, it } from "vitest";\nprocess.on("message", (m) => {\n  if ((m as { type?: string } | null)?.type === "stop") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);\n});\nit("passes", () => expect(1).toBe(1));\n`,
};

describe("VitestAdapter: a teardown timeout after the run (#207)", () => {
  it("hears it during the close, not in the run's report", SLOW, async () => {
    const heard: RelativePath[] = [];
    const project = await openFixture("basic", FILES, (root) =>
      createVitestAdapter({ root, teardown: (files) => heard.push(...files) }),
    );

    const report = await project.adapter.run([ref("late/late.test.ts")], project.runOptions());
    const atReport = [...heard];
    await project.adapter.close();

    expect(report.completedFiles).toEqual([ref("late/late.test.ts")]);
    expect(atReport).toEqual([]);
    expect(heard).toEqual(["late/late.test.ts"]);
  });

  it("tells nothing for a normal teardown", SLOW, async () => {
    const heard: RelativePath[] = [];
    const quick = {
      ...FILES,
      "late/late.test.ts": FILES["late/late.test.ts"].replace("4000", "0"),
    };
    const project = await openFixture("basic", quick, (root) =>
      createVitestAdapter({ root, teardown: (files) => heard.push(...files) }),
    );

    const report = await project.adapter.run([ref("late/late.test.ts")], project.runOptions());
    await project.adapter.close();

    expect(report.completedFiles).toEqual([ref("late/late.test.ts")]);
    expect(heard).toEqual([]);
  });
});
