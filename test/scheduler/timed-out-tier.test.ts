import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { readUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import type { TestCheckId } from "../../src/core/types/check.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { RecordedRun } from "./recording-runner.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

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
/**
 * Only the hanging file may reach it (task 001-335). A tier of three
 * ordinary files took 0.5-2.8 s beside a full suite at load 37-87; one such
 * tier outlasted the 8 s this was at load 76 and ended without its files.
 * Row 010-38: the real timeout is waited twice, so it is 10 s, not 30 s,
 * over four quick files that run beside the hanging one in the first tier.
 */
const TIMEOUT_MS = 10_000;

/** How long the fake hanging file holds its tier before it reports the timeout (row 010-38). */
const FAKE_HOLD_MS = 50;

/** `count` quick test files and one that never ends. */
function suite(count: number) {
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
  // Blocks its worker as a busy loop would, ignoring a cancel, without using a core while it waits.
  writeFileSync(
    at(HANG),
    'import { it } from "vitest";\nit("hangs", () => {\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n});\n',
  );
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
    timeout: 120_000,
  }, async () => {
    const count = 4;
    const repo = suite(count);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
      timeoutMs: TIMEOUT_MS,
      policy: RUN_MISSING,
    });
    await h.scheduler.start();
    await h.quiet();

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
    // Row 011-27: its record says it timed out by a structured cause, not only by its words.
    const records = [...readUnknownFiles(store, worktreeIdFor(repo.main)).values()];
    expect(records.find((r) => r.testFile.path === HANG)?.cause).toBe("timeout");
    // The hanging file never completed, so it has no checks: it counts among the files without.
    expect(h.header().counts).toMatchObject({ pending: 0, unknown: 0 });
    expect(h.header().testFilesWithoutChecks).toMatchObject({ pending: 0, unknown: 1 });
    console.log(
      `001-179: tiers ${runs.map((r) => `${r.files.length} ${r.report.end} (${r.report.completedFiles.length} completed, ${r.report.durationMs} ms)`).join(", ")}`,
    );
  });

  it("splits a tier the hanging file holds up, halving down to one file, and stores the rest", {
    timeout: 120_000,
  }, async () => {
    const count = 6;
    const repo = suite(count);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
      timeoutMs: TIMEOUT_MS,
      policy: RUN_MISSING,
    });
    // Row 010-38: the hanging file runs first on one worker and holds every file behind it, so a
    // tier that holds it completes none of its files and times out, here after 50 ms instead of
    // the policy's timeout. Tiers without it run in Vitest. The real timeout is the test above's.
    const real = h.runner.run;
    h.runner.run = async (files, options) => {
      if (!files.some((f) => f.path === HANG)) return real(files, options);
      await new Promise((done) => setTimeout(done, FAKE_HOLD_MS));
      const report: RunReport = {
        end: "timed-out",
        durationMs: FAKE_HOLD_MS,
        completedFiles: [],
        results: [],
        fileErrors: [],
        failure: `timed out after ${TIMEOUT_MS / 1000} s`,
      };
      h.runner.runs.push({ files, options, report });
      return report;
    };
    await h.scheduler.start();
    await h.quiet();

    const runs = h.runner.runs;
    console.log(
      `001-179 one worker: tiers ${runs.map((r) => `${r.files.length} ${r.report.end} (${r.report.completedFiles.length} completed, ${r.report.durationMs} ms)`).join(", ")}`,
    );
    // The hanging file ran first and held the files behind it: the first tier stored none of them.
    expect(runs[0]?.files).toHaveLength(count + 1);
    expect(runs[0]?.report.completedFiles).toHaveLength(0);
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
