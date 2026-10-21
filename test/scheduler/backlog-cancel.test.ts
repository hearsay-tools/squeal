import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cancelled as cancelText } from "../../src/runners/vitest/run.js";
import { waitFor } from "../watcher/helpers.js";
import { completions, suite } from "./backlog-suite.js";
import { type Harness, openHarness, openRepoStore } from "./helpers.js";

/*
 * Task 001-364 (005-agent-adoption `lessons.md`, proposed row 1): a build
 * that rewrote `dist`, which none of the tier's 200 files reads, cancelled
 * a backlog tier in flight. A revision cancels a backlog tier when it
 * changes an input of the tier or queues an edit's work in its lane; an add
 * or a delete cancels only once its runner part found that it reaches a
 * test file. What the cancelled tier completed keeps its results, as for
 * an edit's cancel (`backlog-tiers.test.ts`); what a touch withheld runs
 * again (`withheld-touch.test.ts`).
 */

/** A 30-file backlog tier in flight, `during` run once its first test ended. */
async function backlogWith(
  during: (h: Harness) => Promise<void>,
): Promise<{ h: Harness; tiers: Harness["runner"]["runs"] }> {
  const mark = join(tmpdir(), `squeal-001-364-${process.pid}-${Date.now()}.log`);
  const repo = suite(30, 1_000, mark);
  writeFileSync(join(repo.main, "build-index-old.js"), "export const built = 1;\n");
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
    tierSize: 4,
    backlogTierSize: 200,
    runnerPartBesideRun: true,
  });
  try {
    await h.scheduler.start();
    await h.scheduler.idle();
    const baselineTiers = h.runner.runs.length;
    rmSync(mark, { force: true });
    let edit: Promise<void> | null = null;
    h.runner.beforeRun = () => {
      edit ??= (async () => {
        await waitFor(() => completions(mark) >= 1, 60_000);
        await during(h);
      })();
    };
    await h.scheduler.requestFullSuite({ force: true });
    await waitFor(() => edit !== null, 60_000);
    await edit;
    await h.scheduler.idle();
    return { h, tiers: h.runner.runs.slice(baselineTiers) };
  } finally {
    rmSync(mark, { force: true });
  }
}

describe("a backlog tier and a revision no file of it reads (task 001-364)", () => {
  it("finishes through an add and a delete no test file reaches", {
    timeout: 120_000,
  }, async () => {
    const { tiers } = await backlogWith(async (h) => {
      h.remove("build-index-old.js");
      h.write("build-index-new.js", "export const built = 2;\n");
      await h.batch("build-index-old.js", "build-index-new.js");
    });

    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.report.failure).toBeNull();
    expect(tiers[0]?.report.completedFiles).toHaveLength(30);
  });

  it("is cancelled for an added test file once its runner part queues it", {
    timeout: 120_000,
  }, async () => {
    const added = "test/added.test.ts";
    const { h, tiers } = await backlogWith(async (h) => {
      h.write(added, 'import { it } from "vitest";\nit("passes", () => {});\n');
      await h.batch(added);
    });

    const [cancelled, next] = tiers;
    expect(cancelled?.files).toHaveLength(30);
    expect(cancelled?.report.failure).toBe(cancelText("backlog"));
    expect(cancelled?.report.completedFiles.length).toBeLessThan(30);
    expect(next?.files.map((f) => f.path)).toContain(added);
    expect(h.runsOf(added)).toHaveLength(1);
    // Every file of the suite ends with a result: the cancelled ones ran again.
    const ran = new Set(tiers.flatMap((t) => t.report.completedFiles.map((f) => f.path)));
    expect(ran.size).toBe(31);
    // What the cancelled tier completed keeps its results: none of it runs again.
    const kept = cancelled?.report.completedFiles.map((f) => f.path) ?? [];
    expect(kept.length).toBeGreaterThan(0);
    const later = new Set(tiers.slice(1).flatMap((t) => t.files.map((f) => f.path)));
    expect(kept.filter((path) => later.has(path))).toEqual([]);
    for (const testPath of kept) {
      const check = { kind: "test", project: "", testPath, fullName: "holds" } as const;
      expect(h.sink.stateOf(check)).toMatchObject({ outcome: "pass", validity: "current" });
    }
  });
});
