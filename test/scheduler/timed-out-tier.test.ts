import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import type { TestCheckId } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, type RecordedRun } from "./helpers.js";

/*
 * 004 lessons, defect 13 (task 001-179): a 200-file backlog tier that reached
 * `runner.timeoutMs` was re-run whole and the baseline never converged. A
 * timed-out tier keeps the files that completed, re-queues the rest in tiers
 * of half as many, and a file that times out alone is `unknown`.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const check = (path: string, fullName: string): TestCheckId => ({
  kind: "test",
  project: "",
  testPath: path,
  fullName,
});

const HANG = "test/hang.test.ts";
const TIMEOUT_MS = 8_000;

/** `count` quick test files and one that never ends; `oneWorker` runs them one at a time, the hanging one first. */
function suite(count: number, oneWorker = false) {
  const repo = createRepo("barrel-only");
  const at = (path: string) => join(repo.main, path);
  rmSync(at("test/aa-slow.test.ts"));
  rmSync(at("test/zz-fast.test.ts"));
  for (let i = 0; i < count; i++) {
    writeFileSync(
      at(`test/f${pad(i)}.test.ts`),
      `import { expect, it } from "vitest";\nit("holds", () => {\n  expect(${i}).toBe(${i});\n});\n`,
    );
  }
  writeFileSync(
    at(HANG),
    'import { it } from "vitest";\nit("hangs", () => {\n  while (true) {}\n});\n',
  );
  if (oneWorker) {
    // One file at a time, the hanging one first: it holds every file behind it.
    writeFileSync(
      at("vitest.config.ts"),
      [
        `import { defineConfig } from "vitest/config";`,
        `import { BaseSequencer } from "vitest/node";`,
        `class HangFirst extends BaseSequencer {`,
        `  async sort(files) {`,
        `    const hang = (f) => (f.moduleId.endsWith("hang.test.ts") ? 0 : 1);`,
        `    return [...files].sort((a, b) => hang(a) - hang(b));`,
        `  }`,
        `}`,
        `export default defineConfig({`,
        `  test: {`,
        `    include: ["test/**/*.test.ts"],`,
        `    testTimeout: 60_000,`,
        `    maxWorkers: 1,`,
        `    fileParallelism: false,`,
        `    sequence: { sequencer: HangFirst },`,
        `  },`,
        `});`,
        "",
      ].join("\n"),
    );
  }
  return repo;
}

/** Each tier holds at most half the files the last tier holding the hanging file left incomplete. */
function expectHalving(runs: readonly RecordedRun[]): void {
  let cap = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    expect(run.files.length).toBeLessThanOrEqual(cap);
    if (run.files.some((f) => f.path === HANG) && run.report.end === "timed-out") {
      cap = Math.max(1, Math.floor((run.files.length - run.report.completedFiles.length) / 2));
    }
  }
}

describe("scheduler: a timed-out tier keeps its completed files (D5, D12, task 001-179)", () => {
  it("stores the files that completed, isolates the hanging one as unknown and finishes the baseline", {
    timeout: 180_000,
  }, async () => {
    const count = 12;
    const repo = suite(count);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
      timeoutMs: TIMEOUT_MS,
    });
    await h.scheduler.start();
    await h.scheduler.idle();

    const runs = h.runner.runs;
    const first = runs[0];
    expect(first?.files.length).toBe(count + 1);
    expect(first?.report.end).toBe("timed-out");
    expectHalving(runs);
    // The hanging file ran alone last, timed out, and is not retried.
    expect(runs.at(-1)?.files.map((f) => f.path)).toEqual([HANG]);
    expect(runs.at(-1)?.report.end).toBe("timed-out");

    for (let i = 0; i < count; i++) {
      expect(h.sink.stateOf(check(`test/f${pad(i)}.test.ts`, "holds"))).toMatchObject({
        outcome: "pass",
        validity: "current",
      });
    }
    // Every quick file completed in some tier.
    const ran = new Set(runs.flatMap((r) => r.report.completedFiles.map(testFileId)));
    expect(ran.size).toBe(count);
    const unknown = h.sink.callsOf("markUnknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.testFiles.map((f) => f.path)).toEqual([HANG]);
    expect(unknown[0]?.reason).toBe(`timed out after ${TIMEOUT_MS / 1000} s`);
    // The hanging file never completed, so it has no checks: it counts among the files without.
    expect(h.header().counts).toMatchObject({ pending: 0, unknown: 0 });
    expect(h.header().testFilesWithoutChecks).toMatchObject({ pending: 0, unknown: 1 });
    console.log(
      `001-179: tiers ${runs.map((r) => `${r.files.length} ${r.report.end} (${r.report.completedFiles.length} completed)`).join(", ")}`,
    );
  });

  it("splits a tier the hanging file holds up, halving down to one file, and stores the rest", {
    timeout: 240_000,
  }, async () => {
    const count = 6;
    const repo = suite(count, true);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
      timeoutMs: TIMEOUT_MS,
    });
    await h.scheduler.start();
    await h.scheduler.idle();

    const runs = h.runner.runs;
    console.log(
      `001-179 one worker: tiers ${runs.map((r) => `${r.files.length} ${r.report.end} (${r.report.completedFiles.length} completed)`).join(", ")}`,
    );
    // The hanging file ran first and held the files behind it: the first tier stored none of them.
    expect(runs[0]?.files).toHaveLength(count + 1);
    expect(runs[0]?.report.completedFiles.length).toBeLessThan(count);
    expectHalving(runs);
    expect(runs.at(-1)?.files.map((f) => f.path)).toEqual([HANG]);
    expect(runs.at(-1)?.report.end).toBe("timed-out");
    for (let i = 0; i < count; i++) {
      expect(h.sink.stateOf(check(`test/f${pad(i)}.test.ts`, "holds"))).toMatchObject({
        outcome: "pass",
        validity: "current",
      });
    }
    expect(h.sink.callsOf("markUnknown").map((c) => c.testFiles.map((f) => f.path))).toEqual([
      [HANG],
    ]);
  });
});
