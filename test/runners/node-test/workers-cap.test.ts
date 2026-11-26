import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { RunOptions } from "../../../src/core/types/runner.js";

/*
 * Row 026-33 (#292): a node:test run starts no more files at once than the
 * tier's grant (`RunOptions.workers`), and the project's concurrency when
 * it has no grant; a run in a check group's lane starts every file, as the
 * scheduler sized it (019 D3). `runNodeTest` is stood in for.
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

const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-workers-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "test"));
writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "w", type: "module" })}\n`);
const FILES = ["a", "b", "c", "d"].map((name) => {
  writeFileSync(
    join(root, `test/${name}.test.mjs`),
    `import { test } from "node:test";\ntest("${name}", () => {});\n`,
  );
  return { project: "p", path: `test/${name}.test.mjs` };
});

const project = { name: "p", node: process.execPath, argv: [], env: {}, include: ["test/*.test.mjs"] };
const sized = await createNodeTestAdapter(project, { root, concurrency: () => 4 });
const unsized = await createNodeTestAdapter(project, { root });
afterAll(async () => {
  await sized.close();
  await unsized.close();
});

/** The concurrency `runNodeTest` was given for a 4-file run; `null` for none. */
async function given(
  adapter: typeof sized,
  extra: Partial<RunOptions>,
): Promise<number | null> {
  calls.length = 0;
  await adapter.run(FILES, { runId: "r", logDir: join(root, "logs"), timeoutMs: null, ...extra });
  return calls[0] ?? null;
}

describe("a node:test run at its grant (row 026-33, #292)", () => {
  it("starts no more files at once than its workers", async () => {
    expect(await given(sized, { workers: 1 })).toBe(1);
    expect(await given(sized, { workers: 2, lane: "node-test" })).toBe(2);
    expect(await given(sized, { workers: 3, lane: "beside:node-test" })).toBe(3);
  });

  it("keeps the project's concurrency at a larger grant and without one", async () => {
    expect(await given(sized, { workers: 8 })).toBe(4);
    expect(await given(sized, {})).toBe(4);
  });

  it("runs at its workers when the project sets no concurrency, and at least 1", async () => {
    expect(await given(unsized, { workers: 2 })).toBe(2);
    expect(await given(unsized, { workers: 0 })).toBe(1);
    expect(await given(unsized, {})).toBeNull();
  });

  it("starts every file in a group's lane, whatever its workers", async () => {
    expect(await given(sized, { workers: 1, lane: "slow:node-test" })).toBeNull();
    expect(await given(sized, { workers: 1, lane: "group:e2e:node-test" })).toBeNull();
  });
});
