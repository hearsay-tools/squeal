import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readStatus } from "../../src/core/status/snapshot.js";
import { listImports } from "../../src/core/store/imports.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { COUNT, daemonOf, environmentWith, importedPasses, publishedRun } from "./daemon-kit.js";
import { scratch } from "./reader-kit.js";
import { cloneOf, git } from "./remote.js";

/*
 * Row 018-44 (`research/live-saving.md` Q3): worktrees of one clone share
 * one store. The reader skipped an export whose commit any import held, so
 * the first worktree to import it decided for all: one whose environment
 * differs from CI's stores the results at CI's keys, which no other worktree
 * computes. On 2026-11-12, 3 of 21 imports in squawk were unusable that way.
 * A held import now holds for this worktree only when it serves it as well
 * as its own import would; else the worktree imports that export for itself.
 */

const SLOW = { timeout: 60_000 } as const;
/** CI's resolved config, and two of a worktree's: `watch` differs within D10, `pool` beyond it. */
const CI = environmentWith('{"pool":"threads","watch":false}');
const MATCHES = environmentWith('{"pool":"threads","watch":true}');
const DIFFERS = environmentWith('{"pool":"forks","watch":true}');

/**
 * CI's export published, `edit`ed when given, and two worktrees of one
 * clone with daemons: X's environment differs from CI's, Y's matches.
 */
async function twoWorktrees(edit?: (bundle: ResultsBundle) => ResultsBundle) {
  const s = scratch();
  const commit = await publishedRun(s, CI, edit);
  const dev = realpathSync(cloneOf(s, "main"));
  const other = join(realpathSync(s.dir), "other");
  git(dev, ["worktree", "add", "-q", "-b", "other", other]);
  const x = await daemonOf(dev, DIFFERS);
  const y = await daemonOf(other, MATCHES);
  /** Points the clone's remote nowhere: a reader that lists or fetches notes it. */
  const offline = () => git(dev, ["remote", "set-url", "origin", join(s.dir, "absent.git")]);
  return { s, commit, dev, other, x, y, offline };
}

describe("an export another worktree of the store imported (row 018-44)", SLOW, () => {
  it("serves a later worktree whose environment matches CI's, though the first one's did not", async () => {
    const { s, commit, dev, other, x, y, offline } = await twoWorktrees();

    // X's environment differs from CI's: its import stores the results at CI's keys.
    const first = x.reader();
    await first.run();
    await x.d.scheduler.idle();
    expect(first.commits()).toEqual([commit]);
    expect(importedPasses(x.d)).toBe(0);

    // Y's matches: it imports that export for itself, at its own keys, and runs nothing.
    const later = y.reader();
    await later.run();
    await y.d.scheduler.idle();
    expect(later.notes).toEqual([]);
    expect(importedPasses(y.d)).toBe(COUNT);
    expect(y.d.runner.runs).toEqual([]);
    expect(readStatus(other)).toMatchObject({
      imports: expect.arrayContaining([
        expect.objectContaining({ testFiles: COUNT, currentFiles: COUNT }),
      ]),
    });

    // Each one's import is held as usable now: a restart of either, and a third worktree
    // whose environment is Y's, reach no remote; the third has the results at its start.
    const imports = listImports(x.d.store).length;
    offline();
    const third = join(realpathSync(s.dir), "third");
    git(dev, ["worktree", "add", "-q", "-b", "third", third]);
    const z = await daemonOf(third, MATCHES);
    expect(importedPasses(z.d)).toBe(COUNT);
    for (const w of [x, y, z]) {
      const restarted = w.reader();
      await restarted.run();
      expect(restarted.notes).toEqual([]);
    }
    expect(listImports(x.d.store)).toHaveLength(imports);
    expect(z.d.runner.runs).toEqual([]);
  });

  it("fetches it once for a worktree whose own import re-keys none of its files", async () => {
    // Keys no run here reproduces: D11's proof fails for every file, in every worktree.
    const { x, y, offline } = await twoWorktrees((bundle) => ({
      ...bundle,
      testFiles: bundle.testFiles.map((f) => ({ ...f, key: `${f.key}-other` })),
      results: bundle.results.map((r) => ({ ...r, key: `${r.key}-other` })),
    }));
    await x.reader().run();
    const later = y.reader();
    await later.run();
    expect(later.notes).toEqual([]);
    expect(listImports(y.d.store)).toHaveLength(2);
    expect(importedPasses(y.d)).toBe(0);

    offline();
    for (const w of [x, y]) {
      const restarted = w.reader();
      await restarted.run();
      expect(restarted.notes).toEqual([]);
    }
    expect(listImports(y.d.store)).toHaveLength(2);
  });
});
