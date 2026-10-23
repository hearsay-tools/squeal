import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_POLICY, type Policy, type TestFileRef } from "../../src/core/types/index.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { focus, focusedRows, focusing, runsSince } from "./focused-fixture.js";
import { heldRun, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-145 (spec 011 C4 step 4 and C15 as amended 2026-10-23): a focused
 * tier counts as a tier of the first group, so a stream of focused waits
 * cannot starve the backlog; and only a fast file whose runner focuses gets
 * an entry. A held tier of 20 s, which yields to nothing, keeps the requests
 * queued until it ends.
 */
const S = "test/s.test.ts";
const BASELINE: Partial<Policy> = { baseline: { onStart: "lookup-then-run-missing" } };

describe("a focused tier and the rest of the queue (spec 011 C4 and C15, row 011-145)", {
  timeout: 120_000,
}, () => {
  it("5: the backlog's turn still comes after four tiers of the first group, focused ones included", async () => {
    const edited = [1, 2, 3, 4, 5].map((i) => `test/f${i}.test.ts`);
    const B = "b/b.test.ts";
    const files: CatchUpFile[] = [
      { path: S, ms: 20_000, imports: ["src/s.ts"] },
      ...edited.map((path) => ({ path, ms: 1, imports: ["src/f.ts"] })),
      { project: "b", path: B, ms: 1, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(files);
    // Tiers of one file: each focused entry is a tier of its own.
    const s = catchUpSide(repo, repo.main, { files, hostSlots: 8, tierSize: 1, policy: BASELINE });
    const record = focusing(s);
    let holding = false;
    s.runner.beforeRun = (run) => {
      if (holding && run.some((f) => f.path === S)) s.runner.hold();
    };
    await s.scheduler.start();
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    holding = true;
    await s.edit("watch", "src/s.ts");
    await heldRun(s, S, base);
    // The edit's five files and the re-keyed project, queued behind it.
    await s.edit("watch", "src/f.ts", "b.config.json");
    await focus(
      s,
      edited.map((path) => ref(path)),
      ["runs"],
      60_000,
    );
    holding = false;
    s.runner.release();
    await s.scheduler.idle();

    const [f1, f2, f3, f4, f5] = edited.map((path) => `${path} focused`);
    expect(runsSince(s, record, base)).toEqual([S, f1, f2, f3, f4, B, f5, ...edited]);
    expect(focusedRows(s).map((run) => [run.testFile.path, run.end])).toEqual(
      edited.map((path) => [path, "completed"]),
    );
    expect(files.every((f) => s.current(f.path))).toBe(true);
  });

  it("5b: under a departure drain's paused backlog, the turn waits and every focused entry runs (review 0.1.280)", async () => {
    const edited = [1, 2, 3, 4, 5].map((i) => `test/f${i}.test.ts`);
    const B = "b/b.test.ts";
    const files: CatchUpFile[] = [
      { path: S, ms: 20_000, imports: ["src/s.ts"] },
      ...edited.map((path) => ({ path, ms: 1, imports: ["src/f.ts"] })),
      { project: "b", path: B, ms: 1, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(files);
    const s = catchUpSide(repo, repo.main, { files, hostSlots: 8, tierSize: 1, policy: BASELINE });
    const record = focusing(s);
    let holding = false;
    s.runner.beforeRun = (run) => {
      if (holding && run.some((f) => f.path === S)) s.runner.hold();
    };
    await s.scheduler.start();
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    holding = true;
    await s.edit("watch", "src/s.ts");
    await heldRun(s, S, base);
    await s.edit("watch", "src/f.ts", "b.config.json");
    await focus(
      s,
      edited.map((path) => ref(path)),
      ["runs"],
      60_000,
    );
    // The last session left: the drain runs the edit's work, and the backlog (B) stays queued.
    s.scheduler.pauseBacklog(true);
    holding = false;
    s.runner.release();
    await s.scheduler.idle();

    const focusedRuns = edited.map((path) => `${path} focused`);
    expect(runsSince(s, record, base)).toEqual([S, ...focusedRuns, ...edited]);
    expect(focusedRows(s).map((run) => [run.testFile.path, run.end])).toEqual(
      edited.map((path) => [path, "completed"]),
    );
    expect(s.current(B)).toBe(false);
  });

  it("5c: a backlog file another worktree's claim holds takes no turn; every focused entry runs (review 0.1.280)", async () => {
    const edited = [1, 2, 3, 4, 5].map((i) => `test/f${i}.test.ts`);
    const B = "b/b.test.ts";
    const files: CatchUpFile[] = [
      { path: S, ms: 20_000, imports: ["src/s.ts"] },
      ...edited.map((path) => ({ path, ms: 1, imports: ["src/f.ts"] })),
      { project: "b", path: B, ms: 1, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(files);
    const s = catchUpSide(repo, repo.main, { files, hostSlots: 8, tierSize: 1, policy: BASELINE });
    await s.scheduler.start();
    await s.scheduler.idle();
    const other = catchUpSide(repo, repo.other, { files, hostSlots: 8, policy: BASELINE });
    await other.scheduler.start();
    await other.scheduler.idle();
    // The other worktree runs B at the key this one's edit will reach (the same bytes: its
    // second edit), held, so its claim stands while this worktree's focused entries wait.
    let otherHolding = true;
    other.runner.beforeRun = (run) => {
      if (otherHolding && run.some((f) => f.path === B)) other.runner.hold();
    };
    const otherBase = other.runner.runs.length;
    other.touch();
    await other.edit("watch", "b.config.json");
    await heldRun(other, B, otherBase);

    const record = focusing(s);
    let holding = false;
    s.runner.beforeRun = (run) => {
      if (holding && run.some((f) => f.path === S)) s.runner.hold();
    };
    const base = s.runner.runs.length;
    holding = true;
    await s.edit("watch", "src/s.ts");
    await heldRun(s, S, base);
    await s.edit("watch", "src/f.ts", "b.config.json");
    await focus(
      s,
      edited.map((path) => ref(path)),
      ["runs"],
      60_000,
    );
    holding = false;
    s.runner.release();
    await expect
      .poll(() => edited.every((path) => s.current(path)), { timeout: 60_000 })
      .toBe(true);

    const focusedRuns = edited.map((path) => `${path} focused`);
    expect(runsSince(s, record, base)).toEqual([S, ...focusedRuns, ...edited]);
    expect(s.current(B)).toBe(false);
    otherHolding = false;
    other.runner.release();
    await other.scheduler.idle();
    // This worktree adopts the other's result for B and never runs it.
    await expect.poll(() => s.current(B), { timeout: 60_000 }).toBe(true);
    await s.scheduler.idle();
    const ranB = s.runner.runs.slice(base).filter((run) => run.files.some((f) => f.path === B));
    expect(ranB).toHaveLength(0);
  });

  it("5d: the turn's tier takes no file whole while its focused entry waits (review 0.1.280)", async () => {
    const edited = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `test/f${i}.test.ts`);
    const B = "b/b.test.ts";
    const files: CatchUpFile[] = [
      { path: S, ms: 20_000, imports: ["src/s.ts"] },
      ...edited.map((path) => ({ path, ms: 1, imports: ["src/f.ts"] })),
      { project: "b", path: B, ms: 1, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(files);
    const s = catchUpSide(repo, repo.main, { files, hostSlots: 8, tierSize: 2, policy: BASELINE });
    const record = focusing(s);
    let holding = false;
    s.runner.beforeRun = (run) => {
      if (holding && run.some((f) => f.path === S)) s.runner.hold();
    };
    await s.scheduler.start();
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    holding = true;
    await s.edit("watch", "src/s.ts");
    await heldRun(s, S, base);
    await s.edit("watch", "src/f.ts", "b.config.json");
    await focus(
      s,
      [...edited].reverse().map((path) => ref(path)),
      ["runs"],
      60_000,
    );
    holding = false;
    s.runner.release();
    await s.scheduler.idle();
    // Tiers of two: four focused tiers, then the turn's tier, which leaves f1 to its waiting
    // focus and takes f2 whole beside B.
    const [f1, f2, f3, f4, f5, f6, f7, f8, f9] = edited;
    expect(runsSince(s, record, base)).toEqual([
      S,
      `${f9},${f8} focused`,
      `${f7},${f6} focused`,
      `${f5},${f4} focused`,
      `${f3},${f2} focused`,
      `${B},${f2}`,
      `${f1} focused`,
      `${f1},${f3}`,
      `${f4},${f5}`,
      `${f6},${f7}`,
      `${f8},${f9}`,
    ]);
    expect(focusedRows(s)).toHaveLength(edited.length);
    expect(files.every((f) => s.current(f.path))).toBe(true);
  });

  it("6: a slow file, and a file whose runner runs whole files only, get no entry", async () => {
    const L = "test/slow/l.test.ts";
    const F = "f/f.test.ts";
    const G = "test/g.test.ts";
    const files: CatchUpFile[] = [
      { path: S, ms: 20_000, imports: ["src/s.ts"] },
      { path: L, ms: 1, imports: ["src/l.ts"] },
      { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
      { path: G, ms: 1, imports: ["src/g.ts"] },
    ];
    const repo = catchUpRepo(files);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-focused-slot-"));
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
    const slow = { ...DEFAULT_POLICY.slow, include: ["test/slow/**"], quietMs: 0 };
    const s = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 8,
      policy: { ...BASELINE, slow },
      scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
    });
    const record = focusing(s);
    // Project "f" runs on a runner that runs whole files only, as node:test's does.
    Object.assign(s.runner, { focusesFile: (file: TestFileRef) => file.project !== "f" });
    let holding = false;
    s.runner.beforeRun = (run) => {
      if (holding && run.some((f) => f.path === S)) s.runner.hold();
    };
    await s.scheduler.start();
    await s.scheduler.idle();
    const base = s.runner.runs.length;
    holding = true;
    await s.edit("watch", "src/s.ts");
    await heldRun(s, S, base);
    await s.edit("watch", "src/l.ts", "src/f.ts", "src/g.ts");
    await focus(s, [ref(L), ref(F, "f"), ref(G)], ["runs"], 60_000);
    holding = false;
    s.runner.release();
    await s.scheduler.idle();

    // Only G ran focused; each of the three ran whole once, at its new key.
    expect(record.checks.flatMap((checks) => checks ?? []).map((c) => c.testFile.path)).toEqual([
      G,
    ]);
    expect(runsSince(s, record, base).filter((run) => run.endsWith(" focused"))).toEqual([
      `${G} focused`,
    ]);
    expect(focusedRows(s).map((run) => run.testFile.path)).toEqual([G]);
    const whole = runsSince(s, record, base).filter((run) => !run.endsWith(" focused"));
    for (const path of [L, F, G]) {
      expect(whole.filter((run) => run.split(",").includes(path))).toHaveLength(1);
    }
    expect(files.every((f) => s.current(f.path))).toBe(true);
  });
});
