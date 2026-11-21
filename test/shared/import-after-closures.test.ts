import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { ImportsSeen } from "../../src/core/shared/imports-seen.js";
import { exportResults } from "../../src/core/store/transfer.js";
import { encodeBundle } from "../../src/core/store/transfer-bundle.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { claimRepo, fileName, type Side, side } from "../scheduler/claims-fixture.js";
import { environmentWith, INPUT, importedPasses, readsInput } from "./daemon-kit.js";
import { publish, readerOf, scratch } from "./reader-kit.js";
import { cloneOf, git } from "./remote.js";

/*
 * Row 018-70 (gh-261, `research/issue-261-ci-import.md` Q2, scenario A; Q5
 * option 2): CI's export of the commit a fast-forward lands on is already
 * published. The reader imports it seconds after the batch, while the
 * revision's runner part, which stores the new closure lists, still runs.
 * An import re-keys a file only when its stored closure list holds every
 * exported path, so a file whose closure gained a path kept CI's keys and
 * ran here (233 of 1,433 files in scenario A). The import still lands at
 * once, so the refinement adopts every other file; once the revision is
 * refined, the same export is imported again and re-keys that file (the
 * coordinator's option C, 2026-11-21). A tier that starts before the second
 * import may still run that file: no loss against the early import alone.
 */

const SLOW = { timeout: 60_000 } as const;
const COUNT = 12;
/** The path the fast-forward adds to the first file's closure. */
const NEW = "src/new.ts";
/** CI's resolved config, and the developer's: `watch` differs within D10, so the import re-keys. */
const CI = environmentWith('{"pool":"threads","watch":false}');
const DEV = environmentWith('{"pool":"threads","watch":true}');
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };

/** The first file's closure holds `NEW` once the worktree has it; each other file's is itself. */
function closures(s: Side): void {
  s.runner.closure = async (testFile: TestFileRef) => ({
    testFile,
    paths:
      testFile.path === fileName(0) && existsSync(join(s.root, NEW))
        ? [testFile.path, NEW]
        : [testFile.path],
  });
}

/** CI's whole suite at the checkout's commit, its export published: the commit. */
async function exported(ci: Side): Promise<string> {
  await ci.scheduler.requestFullSuite();
  await ci.quiet();
  const commit = git(ci.root, ["rev-parse", "HEAD"]);
  const { bundle } = exportResults(ci.store, ci.worktreeId, {
    squealVersion: "0.0.0-test",
    keyFormat: KEY_FORMAT_VERSION,
    commit,
    dirty: false,
    createdAt: 1_762_000_000_000,
    source: { kind: "local" },
  });
  expect(bundle.testFiles).toHaveLength(COUNT);
  git(ci.root, ["push", "-q", "origin", "main"]);
  await publish(ci.root, commit, encodeBundle(bundle));
  return commit;
}

/** The fast-forward: ten files change (a catch-up revision, as a pull) and `NEW` joins the first one's closure. */
const MOVED = [...Array.from({ length: 10 }, (_, i) => fileName(i)), NEW];

/**
 * A developer's lookup-only daemon at c0, every file current from c0's
 * import, then a pull to c1, whose export CI published first. The pull's
 * revision is stored and its runner part, which stores the closure lists,
 * waits until the reader imported c1's export, as in scenario A; then it
 * runs. With `hold`, no backlog tier starts until the test ends the hold.
 */
async function fastForwarded(hold: boolean) {
  const s = scratch();
  const { main: ciRoot } = claimRepo(COUNT, { [INPUT]: "input\n" });
  const ci = side(ciRoot, { count: COUNT });
  ci.runner.environment = CI;
  closures(ci);
  // Each file's run reads a fixture beyond its closure: the import adds observed entries,
  // which key the developer's files as a start would (row 018-28).
  readsInput(ci);
  await ci.scheduler.start();
  git(ciRoot, ["remote", "add", "origin", s.remote]);
  const c0 = await exported(ci);

  const dev = realpathSync(cloneOf(s, "main"));
  const d = side(dev, { count: COUNT, policy: LOOKUP_ONLY });
  d.runner.environment = DEV;
  closures(d);
  const seen = new ImportsSeen(d.store);
  const retry = async () => {
    await seen.take((projects, imports) => d.scheduler.requestImports(projects, imports));
    await d.scheduler.requestRetries();
  };
  await d.scheduler.start();
  await d.quiet();
  // The scheduler's clock: an import's record time is its results', which the scheduler reads as new.
  const r = readerOf(dev, {
    store: d.store,
    imported: () => void retry(),
    refinedPollMs: 10,
    now: () => d.now(),
  });
  await r.run();
  await d.quiet();
  expect(r.commits()).toEqual([c0]);
  expect(importedPasses(d)).toBe(COUNT);

  mkdirSync(join(ciRoot, "src"));
  writeFileSync(join(ciRoot, NEW), "export const n = 1;\n");
  for (let i = 0; i < 10; i++) writeFileSync(join(ciRoot, fileName(i)), `// file ${i} at c1\n`);
  git(ciRoot, ["add", "-A"]);
  git(ciRoot, ["commit", "-qm", "c1"]);
  await ci.batch(...MOVED);
  const c1 = await exported(ci);

  if (hold) d.scheduler.pauseBacklog(true);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invalidate = d.runner.invalidate;
  d.runner.invalidate = async () => {
    await held;
    d.runner.invalidate = invalidate;
    return invalidate();
  };
  git(dev, ["pull", "-q", "--ff-only"]);
  await d.batch(...MOVED);
  // The batch nudges the reader, as the daemon's `afterBatch` does: it imports at once.
  r.reader.nudge();
  for (const deadline = Date.now() + 10_000; !r.commits().includes(c1); await sleep(20)) {
    if (Date.now() > deadline) throw new Error("c1's export was not imported");
  }
  release();
  await r.reader.idle();
  await d.quiet();
  return { d, r };
}

describe("an import of the commit a fast-forward lands on (row 018-70)", SLOW, () => {
  it("re-keys a file whose closure gained a path once the closure lists are stored: current, not run", async () => {
    const { d, r } = await fastForwarded(true);
    expect(importedPasses(d)).toBe(COUNT);
    d.scheduler.pauseBacklog(false);
    await d.quiet();
    expect(d.runner.runs).toEqual([]);
    expect(importedPasses(d)).toBe(COUNT);
    expect(r.notes).toEqual([]);
  });

  it("loses nothing against an import before the closure lists, when a tier starts first", async () => {
    const { d, r } = await fastForwarded(false);
    // At most the file whose closure gained a path ran; every other file is current from the import.
    expect(d.runner.runs.flat().filter((f) => f.path !== fileName(0))).toEqual([]);
    expect(d.passing()).toBe(COUNT);
    expect(importedPasses(d)).toBeGreaterThanOrEqual(COUNT - 1);
    expect(r.notes).toEqual([]);
  });
});
