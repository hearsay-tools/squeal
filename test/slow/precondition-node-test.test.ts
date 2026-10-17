import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  type NodeTestProject,
  type Policy,
  type SlowPrecondition,
} from "../../src/core/types/index.js";
import { SLOW } from "../scheduler/helpers.js";
import { waitFor } from "../watcher/helpers.js";
import { open, scratch, skipReason, slowPolicy, slowRuns } from "./precondition-helpers.js";

/*
 * Review wave-8.1 B4 (spec 004 D8 as amended 2026-10-17, `85f5cce9`): a
 * revision whose policy no longer declares a skipped file's precondition
 * queues that file again, decided per file. A node:test project given its
 * own precondition runs once it is met, though the Vitest files beside it
 * keep the global one and stay skipped; and the reverse, a project whose own
 * precondition is removed, falls to the global one.
 */

const GLOBAL = "missing matches no file (slow.precondition.exists)";

/** A slow node:test project `e2e`, `precondition` its own. */
function e2e(precondition?: SlowPrecondition): NodeTestProject {
  return {
    name: "e2e",
    cwd: "e2e",
    node: process.execPath,
    argv: [],
    env: {},
    include: ["*.test.mjs"],
    slow: true,
    ...(precondition === undefined ? {} : { precondition }),
  };
}

/** Its one test, appending to `ran` in `markers` each time it runs. */
function testFile(markers: string): string {
  return [
    'import { appendFileSync } from "node:fs";',
    'import { test } from "node:test";',
    `test("runs", () => appendFileSync(${JSON.stringify(join(markers, "ran"))}, "x"));`,
    "",
  ].join("\n");
}

const nodeRuns = (markers: string) => {
  const path = join(markers, "ran");
  return existsSync(path) ? readFileSync(path, "utf8").length : 0;
};

async function mixed(global: SlowPrecondition, own?: SlowPrecondition) {
  const markers = scratch("squeal-004-65-e2e-");
  const project = e2e(own);
  let policy: Policy | null = null;
  const h = await open(global, {
    nodeTest: [project],
    files: { "e2e/a.test.mjs": testFile(markers) },
    reloadPolicy: () => policy,
  });
  /** Applies a policy edit giving `e2e` `next` as its own precondition, or none. */
  const reload = async (next?: SlowPrecondition) => {
    const nodeTest = [e2e(next)];
    const slow = slowPolicy(global);
    policy = { ...DEFAULT_POLICY, slow, nodeTest };
    h.write("squeal.config.json", JSON.stringify({ slow, nodeTest }));
    await h.batch("squeal.config.json");
  };
  return { h, markers, reload };
}

describe("a policy edit to one project's precondition (review wave-8.1 B4)", SLOW, () => {
  it("runs the project given its own met precondition, the Vitest files still skipped", async () => {
    const { h, markers, reload } = await mixed({ exists: ["missing"] });
    expect(nodeRuns(markers)).toBe(0);
    expect(slowRuns(h)).toEqual([]);
    expect(h.header().slowTier).toMatchObject({ testFiles: 3, notRun: 3, skipped: GLOBAL });

    await reload({ exists: ["src/strings.ts"] });
    await waitFor(() => nodeRuns(markers) === 1, 60_000);
    await h.scheduler.idle();
    expect(slowRuns(h)).toEqual([]);
    expect(skipReason(h)).toBe(GLOBAL);
    expect(h.header().slowTier).toMatchObject({ current: 1, notRun: 2, skipped: GLOBAL });
  });

  it("runs the project whose own unmet precondition is removed, by the met global one", async () => {
    const own = { exists: ["missing-e2e"] };
    const { h, markers, reload } = await mixed({ exists: ["src/strings.ts"] }, own);
    expect(slowRuns(h)).toHaveLength(2);
    expect(nodeRuns(markers)).toBe(0);
    expect(skipReason(h)).toBe(`missing-e2e matches no file (nodeTest "e2e" precondition.exists)`);

    await reload();
    await waitFor(() => nodeRuns(markers) === 1, 60_000);
    await h.scheduler.idle();
    expect(skipReason(h)).toBeNull();
    expect(h.header().slowTier).toMatchObject({ current: 3, notRun: 0 });
  });
});
