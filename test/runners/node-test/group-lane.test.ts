import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { RunOptions } from "../../../src/core/types/index.js";

/*
 * Spec 004 D2, D4, 019 D3 (row 019-12): a node:test run in a check group's
 * lane, the default `slow` group's `slow:node-test` or a configured group's
 * `group:<name>:node-test`, starts every file it holds, since the scheduler
 * sized the tier; a run in the adapter's own lane or a beside lane keeps the
 * project's concurrency. `runNodeTest` is stood in for.
 */

const calls = vi.hoisted(() => [] as (number | null)[]);

vi.mock("../../../src/runners/node-test/run/run.js", () => ({
  runNodeTest: async (options: { concurrency?: number }) => {
    calls.push(options.concurrency ?? null);
    return {
      report: {
        end: "completed",
        durationMs: 1,
        completedFiles: [],
        results: [],
        fileErrors: [],
        failure: null,
      },
      observed: [],
      reads: [],
    };
  },
}));

const { createNodeTestAdapter } = await import("../../../src/runners/node-test/adapter.js");

const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-group-lane-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "test"));
writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "g", type: "module" })}\n`);
writeFileSync(
  join(root, "test/a.test.mjs"),
  `import { test } from "node:test";\ntest("a", () => {});\n`,
);

const adapter = await createNodeTestAdapter(
  { name: "p", node: process.execPath, argv: [], env: {}, include: ["test/*.test.mjs"] },
  { root, concurrency: () => 3 },
);
afterAll(() => adapter.close());

/** The concurrency `runNodeTest` was given for a run in `lane`; `null` for none. */
async function given(lane: string | undefined): Promise<number | null> {
  calls.length = 0;
  const options: RunOptions = {
    runId: "r",
    logDir: join(root, "logs"),
    timeoutMs: null,
    ...(lane === undefined ? {} : { lane }),
  };
  await adapter.run([{ project: "p", path: "test/a.test.mjs" }], options);
  return calls[0] ?? null;
}

describe("a node:test run in a group's lane (spec 019 D3, row 019-12)", () => {
  it("starts every file in a group's lane, the slow one's included", async () => {
    expect(await given("slow:node-test")).toBeNull();
    expect(await given("group:e2e:node-test")).toBeNull();
  });

  it("keeps the project's concurrency in its own lane and a beside lane", async () => {
    expect(await given("node-test")).toBe(3);
    expect(await given("beside:node-test")).toBe(3);
    expect(await given(undefined)).toBe(3);
  });
});
