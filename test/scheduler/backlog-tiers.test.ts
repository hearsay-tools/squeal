import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { cancelled as cancelText } from "../../src/runners/vitest/run.js";
import { waitFor } from "../watcher/helpers.js";
import { suite } from "./backlog-suite.js";
import { openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Lessons, defect 25: a re-queued suite ran in 559 tiers of exactly 4, 4.6 h
 * where the project's own `npm test` took 514 s. Spec 001 D5 step 5 as
 * amended (task 001-124): while the queue holds backlog work only, a tier
 * takes up to `runner.backlogTierSize` files, and an edit cancels it.
 */
const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

/**
 * Row 010-38: 60 files, not 200, still fill 15 edit-sized tiers of 4, so at most 3 tiers proves
 * machine-wide batching; the cancel suite's 40 files leave 20 behind the 20 that trigger the edit.
 */
const FILES = 60;
const CANCEL_FILES = 40;

describe("scheduler: backlog work runs in machine-wide tiers (D5, defect 25)", () => {
  it("runs a 60-file backlog in at most a few tiers, within 2x a direct vitest run", {
    timeout: 240_000,
  }, async () => {
    const repo = suite(FILES, 20);
    const direct = () => {
      const started = performance.now();
      execFileSync(process.execPath, [vitestBin, "run"], { cwd: repo.main, stdio: "ignore" });
      return Math.round(performance.now() - started);
    };
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
    });
    const started = performance.now();
    await h.scheduler.start();
    await h.quiet();
    const baselineMs = Math.round(performance.now() - started);
    const baselineTiers = h.runner.runs.length;
    expect(baselineTiers).toBeLessThanOrEqual(3);

    // Task 001-320: the backlog is divided by the direct run just before it,
    // so both meet the same load (the shape 001-237 found in graph cost). Row
    // 010-38: one paired round, after the baseline warmed the files, not the
    // median of three after a cold run: at 200 files the three read 1.2-1.3.
    const directMs = direct();
    const before = h.runner.runs.length;
    // An environment change: every key moves, every file is queued again.
    appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
    const at = performance.now();
    await h.batch("vitest.config.ts");
    await h.quiet();
    const backlogMs = Math.round(performance.now() - at);
    const tiers = h.runner.runs.slice(before);
    const ratio = backlogMs / directMs;
    console.log(
      `001-124: direct vitest run ${directMs} ms; baseline ${baselineMs} ms in ${baselineTiers} tiers; ` +
        `backlog after config edit ${backlogMs} ms in ${tiers.length} tiers; ratio ${ratio.toFixed(2)}`,
    );
    expect(new Set(tiers.flatMap((t) => t.files.map(testFileId))).size).toBe(FILES);
    expect(tiers.every((t) => t.report.end === "completed")).toBe(true);
    expect(tiers.length).toBeLessThanOrEqual(3);
    expect(ratio).toBeLessThan(2);
  });

  it("cancels a backlog tier for an edit, keeps its completed files and runs the edit in the next small tier", {
    timeout: 180_000,
  }, async () => {
    // Row 011-387: the trigger and the lower bound read one source, the files
    // the runner told the scheduler ended (`RunOptions.fileEnded`), the same
    // condition that makes a file completed (`endedInTime`). A test's own mark
    // is written before its module ends, so a cancel between the two loses it.
    const repo = suite(CANCEL_FILES, 300);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
    });
    await h.scheduler.start();
    await h.quiet();
    const baselineTiers = h.runner.runs.length;

    const told: string[] = [];
    const recorded = h.runner.run;
    h.runner.run = (files, options) =>
      recorded(
        files,
        files.length < CANCEL_FILES
          ? options
          : {
              ...options,
              fileEnded: (ref) => {
                told.push(ref.path);
                options.fileEnded?.(ref);
              },
            },
      );
    appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
    let edit: Promise<void> | null = null;
    h.runner.beforeRun = () => {
      if (edit !== null) return;
      // Not awaited: the backlog tier runs while the agent edits.
      edit = (async () => {
        await waitFor(() => told.length >= 20, 60_000);
        h.write("src/m023.ts", "export const value = 23; // edited\n");
        await h.batch("src/m023.ts");
      })();
    };
    await h.batch("vitest.config.ts");
    await waitFor(() => edit !== null, 60_000);
    await edit;
    // The cancelled tier's other files come back after the pump's own wait: row 010-38 moves the
    // scheduler's clock past it instead of waiting its 20 s.
    await h.quiet();
    h.advance(BACKLOG_QUIET_MS);
    await h.quiet({ through: ["pump"] });

    const [cancelled, next, ...rest] = h.runner.runs.slice(baselineTiers);
    if (!cancelled || !next) throw new Error("expected a cancelled tier and the edit's tier");
    const kept = cancelled.report.completedFiles.map((f) => f.path);
    console.log(
      `001-124: the backlog tier was cancelled after ${kept.length} of ${cancelled.files.length} files ` +
        `(${told.length} told ended); the edit's tier ran ${next.files.length} files, then ${rest.length} more tiers`,
    );
    expect(cancelled.files).toHaveLength(CANCEL_FILES);
    expect(cancelled.report.failure).toBe(cancelText("backlog"));
    // Every file told ended before the cancel stays completed: at least the 20 that triggered the edit.
    expect(told.length).toBeGreaterThanOrEqual(20);
    expect(kept).toEqual(expect.arrayContaining(told));
    expect(kept.length).toBeLessThan(CANCEL_FILES);
    expect(next.files.length).toBeLessThanOrEqual(4);
    expect(next.files[0]?.path).toBe("test/f023.test.ts");
    // The completed files keep their results: none of them runs again, except the edited one.
    const later = new Set([next, ...rest].flatMap((t) => t.files.map((f) => f.path)));
    expect(kept.filter((path) => path !== "test/f023.test.ts" && later.has(path))).toEqual([]);
    expect(new Set([...kept, ...later]).size).toBe(CANCEL_FILES);
  });

  it("lets a backlog tier finish through an edit no test file reaches", {
    timeout: 120_000,
  }, async () => {
    const mark = join(tmpdir(), `squeal-001-124-${process.pid}-${Date.now()}-unrelated.log`);
    const completions = () =>
      existsSync(mark) ? readFileSync(mark, "utf8").split("\n").length - 1 : 0;
    const repo = suite(30, 1_000, mark);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
    });
    try {
      await h.scheduler.start();
      await h.quiet();
      const baselineTiers = h.runner.runs.length;
      rmSync(mark, { force: true });
      let edit: Promise<void> | null = null;
      h.runner.beforeRun = () => {
        edit ??= (async () => {
          await waitFor(() => completions() >= 1, 60_000);
          // No test file imports `src/math.ts` in this suite.
          h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
          await h.batch("src/math.ts");
        })();
      };
      await h.scheduler.requestFullSuite({ force: true });
      await waitFor(() => edit !== null, 60_000);
      await edit;
      await h.quiet();
      const tiers = h.runner.runs.slice(baselineTiers);
      expect(tiers).toHaveLength(1);
      expect(tiers[0]?.report.failure).toBeNull();
      expect(tiers[0]?.report.completedFiles).toHaveLength(30);
    } finally {
      rmSync(mark, { force: true });
    }
  });
});
