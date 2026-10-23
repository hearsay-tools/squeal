import { describe, expect, it } from "vitest";
import { classLines } from "../../src/cli/named-file-lines.js";
import {
  F,
  filesOf,
  G,
  isSlow,
  named,
  ranSince,
  rowOf,
  SLOW,
  sides,
} from "./tier-yields-claim-fixture.js";
import { CUT_WITHIN_MS, heldRun, holdRuns, pause, ref, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-55 (spec 011 C15 and C7; `tasks/011-51/notes.md`, "Open for
 * later rows"): a promoted file whose key another worktree has claimed waits
 * for that run, so a yield for it would run nothing sooner. Before the row,
 * the tier in its lane yielded to it all the same. Two worktrees on one
 * store; the other runs F's key, held, while this one runs four slow files.
 * `tier-yields-claim-ends.test.ts` has the claim's end (row 011-123).
 */
describe("a promoted file under another worktree's claim makes no tier yield (spec 011 C15, row 011-55)", {
  timeout: 120_000,
}, () => {
  it("the tier runs on, the wait names the claim, and an unclaimed promoted file still cuts it", async () => {
    const { main, other } = await sides(filesOf(200_000, 1));
    // The other worktree re-keys F by its project's environment and runs it, held: its claim.
    const theirs = holdRuns(other.runner, (path) => path === F);
    await other.edit("watch", "f.config.json");
    await heldRun(other, F, 0);

    // The same bytes here: F and G queued behind an edit's tier of the four, F at the claimed key.
    const ours = holdRuns(main.runner, isSlow);
    const base = main.runner.runs.length;
    await main.edit("watch", "src/s.ts", "f.config.json", "g.config.json");
    const tier = await heldRun(main, SLOW[0] ?? "", base);
    expect(rowOf(main, F)).toMatchObject({ pending: "queued", key: rowOf(other, F)?.key });
    expect(rowOf(other, F)?.pending).toBe("running");

    await main.scheduler.promote([ref(F, "f")], 60_000);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    expect(tier.endedAt).toBeNull();
    const file = named(main, ref(F, "f"));
    expect(file.standing).toMatchObject({ kind: "claim", worktree: other.root });
    // The first line is the header, `Pending (1):`.
    const [, line] = classLines([file], "squeal");
    expect(line).toContain(`waiting for ${other.root}'s run of its key, at most until `);
    expect(line).not.toContain("yield");

    // A promoted file no other worktree runs still makes the tier yield.
    await main.scheduler.promote([ref(G, "g")], 60_000);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await expect.poll(() => main.current(G), { timeout: CUT_WITHIN_MS }).toBe(true);
    expect(ranSince(main, F, base)).toBe(0);

    ours.stop();
    theirs.stop();
    await Promise.all([main.scheduler.idle(), other.scheduler.idle()]);
    await expect.poll(() => main.current(F), { timeout: CUT_WITHIN_MS }).toBe(true);
    // F ran once, in the worktree that claimed it; this one took its result.
    expect(ranSince(main, F, base)).toBe(0);
    expect(ranSince(other, F, 0)).toBe(1);
    expect(SLOW.every((path) => main.current(path))).toBe(true);
  });

  it("an edit's promoted file runs here whatever another worktree claims, so the tier yields to it", async () => {
    // F's 300 s known sorts it after the four of 200 s: they fill the tier, F stays queued.
    const { main, other } = await sides(filesOf(200_000, 300_000));
    const theirs = holdRuns(other.runner, (path) => path === F);
    await other.edit("watch", "src/f.ts");
    await heldRun(other, F, 0);

    const ours = holdRuns(main.runner, isSlow);
    const base = main.runner.runs.length;
    // One revision: F is the edit's work at the tier's own revision, so only the promotion waits.
    await main.edit("watch", "src/s.ts", "src/f.ts");
    const tier = await heldRun(main, SLOW[0] ?? "", base);
    expect(rowOf(main, F)).toMatchObject({ pending: "queued", key: rowOf(other, F)?.key });

    await main.scheduler.promote([ref(F, "f")], 60_000);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await expect.poll(() => ranSince(main, F, base), { timeout: CUT_WITHIN_MS }).toBe(1);

    ours.stop();
    theirs.stop();
    await Promise.all([main.scheduler.idle(), other.scheduler.idle()]);
  });
});
