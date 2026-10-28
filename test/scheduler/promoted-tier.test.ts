import { describe, expect, it } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type CatchUpFile, type CatchUpRun, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { ModelClock } from "./model-clock.js";
import { CUT_WITHIN_MS, heldRun, holdRuns, pause, ref, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-265 (gh-79, gh-121; spec 011 C4 step 5 as amended 2026-10-28,
 * `research/issue-79-gate.md` option B): while no edit's work is queued, a
 * tier of promoted files only is sized as the backlog's (the wall budget at
 * the grant) instead of `runner.tierSize`. The 56 promoted files stand for
 * cezar's parity files of #79, the 100 others for the backlog beside them.
 * Only a revision that supersedes such a tier cancels it; an edit's work
 * waits for it to end (coordinator, 2026-10-28). The scheduler's clock is a
 * `ModelClock`, not installed: it stands still, so no tier has run any time
 * and no wait for quiet ends while a test reads.
 */
const X = "test/x.test.ts";
const E = "test/e.test.ts";
const named = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${String(i).padStart(3, "0")}.test.ts`);
const P = named("p", 56);
const B = named("b", 100);
const of = (paths: readonly string[], ms: number, source: string): CatchUpFile[] =>
  paths.map((path) => ({ path, ms, imports: [source] }));
/** Over 30 s, so a tier of P has a remainder an edit's work would make it yield on (rule B). */
const P_MS = 31_000;
// The backlog's files sort first in their group (shortest first), so the edit's tier takes none of P.
const FILES: CatchUpFile[] = [
  ...of([X], 10, "src/x.ts"),
  ...of([E], 10, "src/e.ts"),
  ...of(P, P_MS, "src/p.ts"),
  ...of(B, 1_000, "src/b.ts"),
];
const holdX = (path: string) => path === X;
const holdXP = (path: string) => path === X || P.includes(path);

/**
 * After a baseline, one revision makes X an edit's work and re-keys every
 * other file through the root environment, as the backlog; X's tier is held
 * in flight, its lane busy, while a named wait promotes P. X's 10 ms leaves
 * no remainder to yield on. The pool's 24 slots let one tier take all of P
 * within the wall budget (56 × 31 s over 20 workers or more is under 120 s).
 */
async function promotedBehindEdit(held: (path: string) => boolean) {
  const repo = catchUpRepo(FILES);
  const now = new ModelClock().now;
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 24,
    policy: RUN_MISSING,
    now,
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, held);
  await side.edit("watch", "src/x.ts", "config.json");
  const edit = await heldRun(side, X, base);
  expect(edit.files.some((f) => P.includes(f.path))).toBe(false);
  await side.scheduler.promote(
    P.map((path) => ref(path)),
    600_000,
  );
  return { side, gate, after: side.runner.runs.length };
}

/** `promotedBehindEdit` with P held too: X's tier ends and the promoted-only tier is held in flight. */
async function heldWide() {
  const held = await promotedBehindEdit(holdXP);
  held.side.runner.release();
  const wide = await heldRun(held.side, P[0] ?? "", held.after);
  expect(paths(wide).toSorted()).toEqual(P);
  return { ...held, wide };
}

const paths = (run: CatchUpRun) => run.files.map((f) => f.path);
const holdsP = (run: CatchUpRun) => run.files.some((f) => P.includes(f.path));

describe("a tier of promoted files only is sized as the backlog's (spec 011 C4 step 5, row 011-265)", {
  timeout: 120_000,
}, () => {
  it("56 promoted files beside a backlog run in one wide tier at the grant", async () => {
    const { side, gate, after } = await promotedBehindEdit(holdX);
    gate.stop();
    await side.scheduler.idle();

    const runs = side.runner.runs.slice(after);
    // On main: 14 tiers of 4 (`runner.tierSize`), each an edit's, with no grant.
    expect(runs.filter(holdsP)).toHaveLength(1);
    const [wide] = runs;
    expect(paths(wide as CatchUpRun).toSorted()).toEqual(P);
    expect(wide?.workers).toBeGreaterThan(1);
    expect([...P, ...B, X].every((path) => side.current(path))).toBe(true);
  });

  it("with an edit's work queued, promoted files still run in tiers of runner.tierSize", async () => {
    const { side, gate, after } = await promotedBehindEdit(holdX);
    await side.edit("watch", "src/e.ts");
    gate.stop();
    await side.scheduler.idle();

    const runs = side.runner.runs.slice(after).filter(holdsP);
    expect(runs.flatMap(paths).toSorted()).toEqual(P);
    for (const run of runs) {
      expect(run.files.length).toBeLessThanOrEqual(4);
      expect(run.workers).toBeUndefined();
    }
    expect([...P, E].every((path) => side.current(path))).toBe(true);
  });

  it("an edit's work waits for it to end, then starts in the next tier", async () => {
    const { side, gate, wide } = await heldWide();
    // E is no input of the tier; on an edit's tier, its 31 s remainder would make it yield.
    await side.edit("watch", "src/e.ts");
    await pause(SETTLE_MS);
    expect(wide.cancelled).toBe(false);
    expect(wide.endedAt).toBeNull();

    gate.stop();
    await side.scheduler.idle();
    expect(wide.completed.map((f) => f.path).toSorted()).toEqual(P);
    const next = side.runner.runs[side.runner.runs.indexOf(wide) + 1];
    expect(next === undefined ? [] : paths(next)).toContain(E);
    expect([...P, ...B, E].every((path) => side.current(path))).toBe(true);
  });

  it("an edit that changes an input of every unfinished file cancels it", async () => {
    const { side, gate, wide } = await heldWide();
    await side.edit("watch", "src/p.ts");
    await expect.poll(() => wide.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    expect(wide.completed).toEqual([]);

    gate.stop();
    // The cancel made the lane wait for quiet; the backlog starts once it ends.
    await expect
      .poll(() => P.every((path) => side.current(path)), { timeout: CUT_WITHIN_MS })
      .toBe(true);
    side.advance(BACKLOG_QUIET_MS);
    await side.scheduler.idle();
    expect([...P, ...B].every((path) => side.current(path))).toBe(true);
  });

  it("a wait for quiet after its cancel does not hold the next promoted-only tier", async () => {
    const { side, gate, wide } = await heldWide();
    // The environment changes an input of every file of the tier and queues no edit's work.
    await side.edit("watch", "config.json");
    await expect.poll(() => wide.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    const again = await heldRun(side, P[0] ?? "", side.runner.runs.indexOf(wide) + 1);
    expect(paths(again).toSorted()).toEqual(P);
    gate.stop();
    side.advance(BACKLOG_QUIET_MS);
    await side.scheduler.idle();
    expect([...P, ...B].every((path) => side.current(path))).toBe(true);
  });
});
