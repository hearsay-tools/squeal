import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { CANCELLED } from "../../src/runners/vitest/run.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore } from "./helpers.js";

/*
 * Lessons, defect 25: a re-queued suite ran in 559 tiers of exactly 4, 4.6 h
 * where the project's own `npm test` took 514 s. Spec 001 D5 step 5 as
 * amended (task 001-124): while the queue holds backlog work only, a tier
 * takes up to `runner.backlogTierSize` files, and an edit cancels it.
 */
const pad = (n: number) => String(n).padStart(3, "0");
const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

/** `count` test files, each importing its own module and waiting `sleepMs`; `mark` gets a line per test. */
function suite(count: number, sleepMs: number, mark?: string) {
  const repo = createRepo("barrel-only");
  const at = (path: string) => join(repo.main, path);
  rmSync(at("test/aa-slow.test.ts"));
  rmSync(at("test/zz-fast.test.ts"));
  for (let i = 0; i < count; i++) {
    writeFileSync(at(`src/m${pad(i)}.ts`), `export const value = ${i};\n`);
    writeFileSync(
      at(`test/f${pad(i)}.test.ts`),
      [
        `import { appendFileSync } from "node:fs";`,
        `import { expect, it } from "vitest";`,
        `import { value } from "../src/m${pad(i)}.ts";`,
        `it("holds", async () => {`,
        `  await new Promise((resolve) => setTimeout(resolve, ${sleepMs}));`,
        `  expect(value).toBe(${i});`,
        mark === undefined ? "" : `  appendFileSync(${JSON.stringify(mark)}, "${i}\\n");`,
        `});`,
        "",
      ].join("\n"),
    );
  }
  return repo;
}

describe("scheduler: backlog work runs in machine-wide tiers (D5, defect 25)", () => {
  it("runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run", {
    timeout: 300_000,
  }, async () => {
    const repo = suite(200, 20);
    const direct = () => {
      const started = performance.now();
      execFileSync(process.execPath, [vitestBin, "run"], { cwd: repo.main, stdio: "ignore" });
      return Math.round(performance.now() - started);
    };
    const directMs = Math.min(direct(), direct());

    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
    });
    let started = performance.now();
    await h.scheduler.start();
    await h.scheduler.idle();
    const baselineMs = Math.round(performance.now() - started);
    const baselineTiers = h.runner.runs.length;

    // An environment change: every key moves, all 200 files are queued again.
    appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
    started = performance.now();
    await h.batch("vitest.config.ts");
    await h.scheduler.idle();
    const backlogMs = Math.round(performance.now() - started);
    const tiers = h.runner.runs.slice(baselineTiers);

    console.log(
      `001-124: direct vitest run ${directMs} ms; baseline ${baselineMs} ms in ${baselineTiers} tiers; ` +
        `backlog after a config edit ${backlogMs} ms in ${tiers.length} tiers`,
    );
    expect(new Set(tiers.flatMap((t) => t.files.map(testFileId))).size).toBe(200);
    expect(tiers.every((t) => t.report.end === "completed")).toBe(true);
    expect(baselineTiers).toBeLessThanOrEqual(3);
    expect(tiers.length).toBeLessThanOrEqual(3);
    expect(backlogMs).toBeLessThan(2 * directMs);
  });

  it("cancels a backlog tier for an edit, keeps its completed files and runs the edit in the next small tier", {
    timeout: 300_000,
  }, async () => {
    const mark = join(tmpdir(), `squeal-001-124-${process.pid}-${Date.now()}.log`);
    const completions = () =>
      existsSync(mark) ? readFileSync(mark, "utf8").split("\n").length - 1 : 0;
    const repo = suite(200, 300, mark);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
    });
    try {
      await h.scheduler.start();
      await h.scheduler.idle();
      const baselineTiers = h.runner.runs.length;

      appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
      rmSync(mark, { force: true });
      let edit: Promise<void> | null = null;
      h.runner.beforeRun = () => {
        if (edit !== null) return;
        // Not awaited: the backlog tier runs while the agent edits.
        edit = (async () => {
          await waitFor(() => completions() >= 20, 60_000);
          h.write("src/m123.ts", "export const value = 123; // edited\n");
          await h.batch("src/m123.ts");
        })();
      };
      await h.batch("vitest.config.ts");
      await waitFor(() => edit !== null, 60_000);
      await edit;
      await h.scheduler.idle();

      const [cancelled, next, ...rest] = h.runner.runs.slice(baselineTiers);
      if (!cancelled || !next) throw new Error("expected a cancelled tier and the edit's tier");
      const kept = cancelled.report.completedFiles.map((f) => f.path);
      console.log(
        `001-124: the backlog tier was cancelled after ${kept.length} of ${cancelled.files.length} files; ` +
          `the edit's tier ran ${next.files.length} files, then ${rest.length} more tiers`,
      );
      expect(cancelled.files).toHaveLength(200);
      expect(cancelled.report.failure).toBe(CANCELLED);
      expect(kept.length).toBeGreaterThanOrEqual(20);
      expect(kept.length).toBeLessThan(200);
      expect(next.files.length).toBeLessThanOrEqual(4);
      expect(next.files[0]?.path).toBe("test/f123.test.ts");
      // The completed files keep their results: none of them runs again, except the edited one.
      const later = new Set([next, ...rest].flatMap((t) => t.files.map((f) => f.path)));
      expect(kept.filter((path) => path !== "test/f123.test.ts" && later.has(path))).toEqual([]);
      expect(new Set([...kept, ...later]).size).toBe(200);
    } finally {
      rmSync(mark, { force: true });
    }
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
      await h.scheduler.idle();
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
      await h.scheduler.idle();
      const tiers = h.runner.runs.slice(baselineTiers);
      expect(tiers).toHaveLength(1);
      expect(tiers[0]?.report.failure).toBeNull();
      expect(tiers[0]?.report.completedFiles).toHaveLength(30);
    } finally {
      rmSync(mark, { force: true });
    }
  });

  it("caps a backlog tier at half of runner.timeoutMs of last known file time", {
    timeout: 120_000,
  }, async () => {
    const repo = suite(9, 300);
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
    });
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(first.runner.runs).toHaveLength(1);
    await first.scheduler.close();
    await first.runner.close();

    // Durations are known now; the budget is 1,200 ms of them, about three files.
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
      timeoutMs: 2_400,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    const sizes = h.runner.runs.map((r) => r.files.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(9);
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(3);
  });
});
