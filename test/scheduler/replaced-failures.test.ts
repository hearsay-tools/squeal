import { existsSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRetries } from "../../src/core/retry/index.js";
import { formatCheck } from "../../src/core/state/index.js";
import { formatFailures, formatWhy, readFailures, readWhy } from "../../src/core/status/index.js";
import type { AbsolutePath, FailuresReport, WhyReport } from "../../src/core/types/index.js";
import { addWorktree, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { ask, FLAKY, failing, flakyRepo, flips, loadKnob, pass } from "./retry-fixture.js";

/*
 * 011-64 R3 test 1 (gh-54, row 011-77): issue 54's probe scenario through the
 * product scheduler. A fail at 3.33 load per CPU, then a passing `load` retry
 * at the same key: the failure stays in `failures`, marked `REPLACED`, and
 * `why` names its run, its log and its first error's stack.
 */

const ABOVE = 26.64; // 3.33 per CPU on the knob's 8 CPUs
const BELOW = 4;

describe("a failure a passing retry replaced at its key (011-77)", SLOW, () => {
  it("stays in failures as REPLACED and in why with its run, log and stack", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    load.set(ABOVE);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      hostLoad: load.read,
      rerunCap: 0,
    });
    const key = await failing(h);
    const [failed] = store.results.listForCheck(flips, 1);
    const failRun = failed?.provenance.runId as string;
    const failLog = store.runs.get(failRun)?.logDir as string;

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    rmSync(repo.marker);
    load.set(BELOW);
    await pass(h);
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
    expect(h.keyOf(FLAKY)).toBe(key);
    const [passed] = store.results.listForCheck(flips, 1);
    expect(passed?.outcome).toBe("pass");
    const passRun = passed?.provenance.runId as string;

    const cwd = repo.main as AbsolutePath;
    const failures = readFailures(cwd) as FailuresReport;
    expect(failures).toMatchObject({ total: 1, replaced: 1 });
    expect(failures.failures[0]).toMatchObject({
      check: flips,
      runId: failRun,
      revision: failed?.provenance.revision,
      recordedAt: failed?.provenance.recordedAt,
      loadPerCpu: 3.33,
      replacedBy: { runId: passRun, worktreeId: h.worktreeId },
    });
    const text = formatFailures(failures);
    expect(text).toContain("(1 failure, 1 replaced, newest first)");
    expect(text).toMatch(new RegExp(`\\n {2}REPLACED {2}\\S+ {2}${FLAKY} > flips\\n`));
    expect(text).toContain(`run ${failRun}`);
    expect(text).toContain(`replaced by PASS `);
    expect(text).toContain(`run ${passRun}), load 3.33 per CPU when it ran`);

    const why = readWhy(cwd, formatCheck(flips)) as WhyReport;
    expect(why.replacedFailures).toHaveLength(1);
    expect(why.replacedFailures?.[0]).toMatchObject({
      failure: { provenance: { runId: failRun }, key },
      logDir: failLog,
    });
    const whyText = formatWhy(why);
    expect(whyText).toContain("Replaced failures (1, newest first):");
    expect(whyText).toContain(`run ${failRun}`);
    expect(whyText).toContain(`log: ${failLog}`);
    expect(existsSync(failLog)).toBe(true);
    // The first error's stack, from the kept failure text.
    expect(whyText).toMatch(/AssertionError: expected true to be false[\s\S]*at .*flaky\.test\.ts/);
    // The flaky note's sub-line is left out: the entry at its key says more.
    expect(whyText).not.toContain("the FAIL it replaced");

    // Across a daemon restart and its first prune: the entry is the store's, not the daemon's.
    await h.scheduler.close();
    const next = await openHarness(repo.main, store, repo.commonDir, { hostLoad: load.read });
    await next.scheduler.start();
    await next.scheduler.idle();
    store.prune({ now: Date.now() + 60 * 60 * 1000, retentionDays: 7, maxSizeMb: null });
    const kept = readFailures(cwd) as FailuresReport;
    expect(kept).toMatchObject({ total: 1, replaced: 1 });
    expect(kept.failures[0]).toMatchObject({ runId: failRun, replacedBy: { runId: passRun } });
    const again = formatWhy(readWhy(cwd, formatCheck(flips)));
    expect(again).toMatch(/AssertionError: expected true to be false[\s\S]*at .*flaky\.test\.ts/);
    expect(again).toContain(`log: ${failLog}`);
  });

  it("keeps another worktree's failure that this worktree's pass replaced, for both worktrees", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const a = await openHarness(repo.main, store, repo.commonDir, {
      hostLoad: load.read,
      rerunCap: 0,
    });
    const key = await failing(a);
    const [failed] = store.results.listForCheck(flips, 1);

    const other = addWorktree(repo.main, repo.dir, "b");
    rmSync(repo.marker);
    const b = await openHarness(other, store, repo.commonDir, { rerunCap: 0 });
    // A lookup hit takes A's failure, held until it runs here; it passes here at the same key.
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.keyOf(FLAKY)).toBe(key);
    const [passed] = store.results.listForCheck(flips, 1);
    expect(passed).toMatchObject({ outcome: "pass", provenance: { worktreeId: b.worktreeId } });

    for (const cwd of [repo.main, other] as AbsolutePath[]) {
      const failures = readFailures(cwd, { allWorktrees: true }) as FailuresReport;
      expect(failures.failures).toMatchObject([
        {
          runId: failed?.provenance.runId,
          worktreeId: a.worktreeId,
          replacedBy: { worktreeId: b.worktreeId, runId: passed?.provenance.runId },
        },
      ]);
      const why = readWhy(cwd, formatCheck(flips)) as WhyReport;
      expect(why.replacedFailures?.map((r) => r.failure.provenance.runId)).toEqual([
        failed?.provenance.runId,
      ]);
    }
  });
});
