import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type FocusedRun, readFocused } from "../../src/core/scheduler/focused-row.js";
import { createRepo, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";

/*
 * Row 011-145 on a real Vitest adapter (spec 011 C4, C5 and C15 as amended
 * 2026-10-23): the issue-64 probe's shared parity file, 30 checks of 400 ms,
 * with two new failing checks where the probe puts them
 * (`docs/specifications/011-core/research/probes/issue-64/fixture/test/parity.test.ts`).
 * A named wait with `--check new` sends `promote` and `focus`: the two run
 * first and alone, and their red is in the focused meta row before the
 * file's own run of about 12 s starts.
 */
const PARITY = "test/parity.test.ts";
const MATH = "test/math.test.ts";
const SOURCE = `import { describe, expect, it } from "vitest";
const slow = () => new Promise((r) => setTimeout(r, 400));
describe("parity", () => {
  for (let i = 0; i < 30; i++) {
    it(\`existing \${i}\`, async () => { await slow(); expect(i).toBe(i); });
  }
  it("new U2", () => { expect(2).toBe(3); });
  it("new U3", () => { expect(3).toBe(4); });
});
`;

describe("focused checks on a real Vitest adapter (row 011-145)", SLOW, () => {
  it("the focused red is in the meta row before the file's own run starts", async () => {
    const repo = createRepo("basic");
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      policy: { baseline: { onStart: "lookup-then-run-missing" } },
    });
    // The daemon's fast Vitest runner focuses (`createRecoveringRunner`'s `focuses`).
    Object.assign(h.runner, { focuses: true });
    const { focus } = h.scheduler;
    if (focus === undefined) throw new Error("the scheduler cannot focus");
    await h.scheduler.start();
    await h.scheduler.idle();

    // A tier of a short known file holds the lane while the requests come; it yields to nothing.
    let open = () => {};
    const blocked = new Promise<void>((resolve) => {
      open = resolve;
    });
    let held = false;
    /** The focused meta row as the file's own run starts. */
    const seen: { atOwnRun: FocusedRun[] | null } = { atOwnRun: null };
    h.gate.before = async (files, options) => {
      if (files.some((f) => f.path === MATH)) {
        held = true;
        await blocked;
      }
      if (options.checks === undefined && files.some((f) => f.path === PARITY)) {
        seen.atOwnRun ??= readFocused(h.store, h.worktreeId);
      }
    };
    appendFileSync(join(repo.main, MATH), "// edited\n");
    await h.batch(MATH);
    await expect.poll(() => held, { timeout: 60_000 }).toBe(true);
    h.write(PARITY, SOURCE);
    await h.batch(PARITY);
    // A named wait names files the listing holds (row 011-146): the new file is listed and keyed.
    await expect.poll(() => h.keyOf(PARITY), { timeout: 60_000 }).not.toBeNull();
    await h.scheduler.promote([ref(PARITY)], 60_000);
    await focus.call(h.scheduler, [ref(PARITY)], ["new"], 60_000);
    open();
    await h.scheduler.idle();

    const [focused, own] = h.runsOf(PARITY);
    expect(focused?.options.checks).toEqual([{ testFile: ref(PARITY), texts: ["new"] }]);
    expect(focused?.report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
      ["parity > new U2", "fail"],
      ["parity > new U3", "fail"],
    ]);
    expect(own?.options.checks).toBeUndefined();
    expect(seen.atOwnRun).toEqual([
      expect.objectContaining({ testFile: ref(PARITY), texts: ["new"], end: "completed" }),
    ]);
    const [entry] = seen.atOwnRun ?? [];
    expect(entry?.matched).toBe(2);
    expect(entry?.checks.map((c) => c.outcome)).toEqual(["fail", "fail"]);
    expect(entry?.checks.every((c) => c.summary !== null)).toBe(true);
    // The file's own run stores: its two new failures are known, at its key.
    const failing = h.store.knownStates
      .list(h.worktreeId)
      .filter((k) => k.check.testPath === PARITY && k.outcome === "fail");
    expect(failing).toHaveLength(2);
  });
});
