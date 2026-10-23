import { describe, expect, it } from "vitest";
import type { Policy, TestCheckId } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { focus, focusedRows, focusing, isFocused, runsSince } from "./focused-fixture.js";
import {
  CUT_WITHIN_MS,
  completions,
  heldRun,
  pause,
  ref,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Row 011-145, R2 of `tasks/011-135/design.md` (spec 011 C4, C5 and C15 as
 * amended 2026-10-23): a named wait's focused entry runs the selected
 * checks of a fast file first, in a tier of its own, and stores nothing
 * under a key. One lane; a held run stands for one of its files' `ms`, and
 * the fixture's one check per file, `runs`, is what the texts select.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const F = "f/f.test.ts";
const FILE = ref(F, "f");
const CHECK: TestCheckId = { kind: "test", project: "f", testPath: F, fullName: "runs" };
/** The start runs every file, whatever the default baseline (row 011-159). */
const BASELINE: Partial<Policy> = { baseline: { onStart: "lookup-then-run-missing" } };

/** Four files of `ms` behind `src/s.ts`, and `F` of 1 ms in its own project. */
function side(ms: number): { side: CatchUpSide; files: CatchUpFile[] } {
  const files: CatchUpFile[] = [
    ...SLOW.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
  ];
  const repo = catchUpRepo(files);
  return { side: catchUpSide(repo, repo.main, { files, hostSlots: 8, policy: BASELINE }), files };
}

/**
 * Holds each run `held` names until the next run it does not name starts
 * or `free` is called; `held` reads whether the run was given texts.
 */
function holdWhere(s: CatchUpSide, held: (path: string, focused: boolean) => boolean) {
  const record = focusing(s);
  s.runner.beforeRun = (files) => {
    const focused = isFocused(record, s.runner.runs.length - 1);
    if (files.some((f) => held(f.path, focused))) s.runner.hold();
    else s.runner.release();
  };
  return record;
}

describe("a focused tier (spec 011 C4 and C15 as amended 2026-10-23, row 011-145)", {
  timeout: 120_000,
}, () => {
  it("1: a 200 s tier yields to it; it runs only the texts and stores nothing; the file's own run follows, stores and re-runs its new failure once", async () => {
    const { side: s, files } = side(200_000);
    let phase: "slow" | "focused" | "own" | "free" = "free";
    const record = holdWhere(s, (path, focused) => {
      if (phase === "slow") return SLOW.includes(path);
      if (phase === "focused") return path === F && focused;
      return phase === "own" && path === F && !focused;
    });
    await s.scheduler.start();
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    const transitions = s.store.transitions.history(s.worktreeId, CHECK).length;
    s.runner.failing.add(F);
    phase = "slow";
    // An edit's tier of the four; F is re-keyed by its project's environment, behind it.
    await s.edit("watch", "src/s.ts", "f.config.json");
    const cut = await heldRun(s, SLOW[0] ?? "", base);
    phase = "focused";
    await s.scheduler.promote([FILE], 60_000);
    await focus(s, [FILE], ["runs"], 60_000);
    await expect.poll(() => cut.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);

    const first = await heldRun(s, F, base);
    const at = s.runner.runs.indexOf(first);
    expect(record.checks[at]).toEqual([{ testFile: FILE, texts: ["runs"] }]);
    const [started] = focusedRows(s);
    expect(started).toMatchObject({ testFile: FILE, texts: ["runs"], endedAt: null, end: null });
    // What the focused run's results say of the file's time must not reach the store.
    const f = files.find((file) => file.path === F);
    if (f !== undefined) Object.assign(f, { ms: 5_000 });

    phase = "own";
    s.runner.release();
    const own = await heldRun(s, F, at + 1);
    expect(s.runner.runs.indexOf(own)).toBe(at + 1);
    if (f !== undefined) Object.assign(f, { ms: 1 });
    const [ended] = focusedRows(s);
    expect(ended).toMatchObject({
      runId: started?.runId,
      key: started?.key,
      end: "completed",
      matched: 1,
      checks: [{ check: CHECK, outcome: "fail", durationMs: 5_000, summary: expect.any(String) }],
    });
    expect(ended?.endedAt).toEqual(expect.any(Number));
    // Written twice, at the start and at the end, and nothing stored under a key.
    expect(record.writes.filter((w) => w.some((r) => r.runId === started?.runId))).toHaveLength(2);
    const stored = s.store.results.listForCheck(CHECK, 50);
    expect(stored.filter((r) => r.provenance.runId === started?.runId)).toEqual([]);
    expect(stored.every((r) => r.durationMs !== 5_000)).toBe(true);
    expect(s.store.results.byKey(started?.key ?? null)).toEqual([]);
    expect(s.store.transitions.history(s.worktreeId, CHECK)).toHaveLength(transitions);
    const state = s.store.knownStates
      .list(s.worktreeId)
      .find((k) => k.check.kind === "test" && k.check.testPath === F);
    expect(state?.outcome).toBe("pass");
    expect(s.store.runs.get(started?.runId ?? "")).toMatchObject({ end: "completed" });

    phase = "free";
    s.runner.release();
    await s.scheduler.idle();
    // C5 unchanged: the own run's new failure is re-run once, so two whole runs fail it.
    const runsOfF = s.runner.runs.slice(base).filter((r) => r.files.some((x) => x.path === F));
    expect(runsOfF).toHaveLength(3);
    expect(s.current(F)).toBe(true);
    expect(
      s.store.knownStates
        .list(s.worktreeId)
        .find((k) => k.check.kind === "test" && k.check.testPath === F)?.outcome,
    ).toBe("fail");
    expect(s.store.transitions.history(s.worktreeId, CHECK)).toHaveLength(transitions + 1);
    for (const path of SLOW) expect(completions(s, path, base)).toBe(1);
  });

  it("2: a tier with 30 s or less left does not yield; the focused tier follows it", async () => {
    const { side: s } = side(20_000);
    let holding = false;
    const record = holdWhere(s, (path) => holding && SLOW.includes(path));
    await s.scheduler.start();
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    holding = true;
    await s.edit("watch", "src/s.ts", "f.config.json");
    const tier = await heldRun(s, SLOW[0] ?? "", base);

    await focus(s, [FILE], ["runs"], 60_000);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    expect(tier.endedAt).toBeNull();
    holding = false;
    s.runner.release();
    await s.scheduler.idle();

    const after = runsSince(s, record, s.runner.runs.indexOf(tier));
    expect(after).toEqual([SLOW.join(","), `${F} focused`, F]);
    expect(tier.completed).toHaveLength(4);
  });

  it("3: a result at the file's current key drops the entry with no run", async () => {
    const { side: s } = side(1);
    let holding = false;
    const record = holdWhere(s, (path) => holding && path === F);
    await s.scheduler.start();
    await s.scheduler.idle();
    // Current at its key: nothing runs.
    await focus(s, [FILE], ["runs"], 60_000);
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    expect(focusedRows(s)).toEqual([]);

    // Its own run is in flight when the request comes, and ends first.
    holding = true;
    await s.edit("watch", "src/f.ts");
    const own = await heldRun(s, F, base);
    await focus(s, [FILE], ["runs"], 60_000);
    await pause(SETTLE_MS);
    expect(own.cancelled).toBe(false);
    holding = false;
    s.runner.release();
    await s.scheduler.idle();

    expect(runsSince(s, record, base)).toEqual([F]);
    expect(focusedRows(s)).toEqual([]);
  });

  it.each([
    { name: "while the deadline holds it runs again at the new key", late: false },
    { name: "past the deadline it does not run again", late: true },
  ])("4: an input changed during the focused run discards it; $name", async ({ late }) => {
    const { side: s } = side(20_000);
    let phase: "slow" | "focused" | "free" = "free";
    const record = holdWhere(s, (path, focused) =>
      phase === "slow" ? SLOW.includes(path) : phase === "focused" && path === F && focused,
    );
    await s.scheduler.start();
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    phase = "slow";
    await s.edit("watch", "src/s.ts", "f.config.json");
    await heldRun(s, SLOW[0] ?? "", base);
    await focus(s, [FILE], ["runs"], 60_000);
    phase = "focused";
    s.runner.release();
    const first = await heldRun(s, F, base);
    const [started] = focusedRows(s);

    await s.edit("watch", "src/f.ts");
    if (late) s.advance(61_000);
    phase = "free";
    s.runner.release();
    await s.scheduler.idle();

    const discarded = record.writes.flat().find((r) => r.end === "discarded");
    expect(discarded).toMatchObject({ runId: started?.runId, key: started?.key, checks: [] });
    expect(discarded?.reason).toContain("src/f.ts");
    expect(first.files.map((f) => f.path)).toEqual([F]);
    const [last] = focusedRows(s);
    if (late) {
      expect(runsSince(s, record, base)).toEqual([SLOW.join(","), `${F} focused`, F]);
      expect(last).toMatchObject({ runId: started?.runId, end: "discarded" });
    } else {
      expect(runsSince(s, record, base)).toEqual([
        SLOW.join(","),
        `${F} focused`,
        `${F} focused`,
        F,
      ]);
      expect(last).toMatchObject({ end: "completed", matched: 1 });
      expect(last?.key).not.toBe(started?.key);
    }
    expect(s.current(F)).toBe(true);
  });
});
