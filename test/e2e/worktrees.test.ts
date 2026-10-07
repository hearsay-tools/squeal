import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { expectAgrees, headerRevision } from "./agree.js";
import { type E2E, e2eSuite, HOOK_BUDGET_MS, OTHER_SESSION, STRINGS } from "./harness.js";

/*
 * Spec 001 goals 4 and 7 and Testing, end to end: a second worktree's daemon
 * bootstraps from the shared store with zero runs and reports its results as
 * inherited; an edit there runs only its affected test files and tells the
 * first worktree's consumer nothing.
 */

const fixture = e2eSuite();
const quiet = (s: StatusSnapshot) => s.knownFailures.length === 0;

/** A main worktree with a passing baseline and a second worktree whose daemon has settled. */
async function twoWorktrees(e: E2E) {
  await e.hook("session-start", e.main);
  await e.daemonReady(e.main);
  const main = await e.settle(e.main, "the main baseline", (s) => s.counts.current > 0 && quiet(s));
  const wt2 = e.addWorktree();
  // The store exists now, so this SessionStart registers at once (D9).
  const start = await e.hook("session-start", wt2, { session_id: OTHER_SESSION });
  expect(start).toMatchObject({ code: 0, stderr: "" });
  expect(start.ms).toBeLessThan(HOOK_BUDGET_MS);
  expect(start.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
  const ping = await e.daemonReady(wt2);
  expect(ping.root).toBe(wt2);
  const second = await e.settle(
    wt2,
    "the second worktree's baseline",
    (s) => s.counts.current === main.counts.current,
  );
  return { main, wt2, second };
}

describe("a second worktree", () => {
  it("bootstraps with zero runs and inherited provenance", async (ctx) => {
    const e = fixture(ctx);
    const { main, wt2, second } = await twoWorktrees(e);

    expect(e.runs(e.main).length).toBeGreaterThan(0);
    expect(e.runs(wt2)).toEqual([]);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: e.main, encoding: "utf8" });
    expect(second.inherited).toEqual({
      count: main.counts.current,
      sources: [
        {
          worktreeId: worktreeIdFor(e.main),
          worktreeRoot: e.main,
          commit: head.trim(),
          count: main.counts.current,
        },
      ],
    });
    expect(second.knownFailures).toEqual([]);

    // The consumer registered before the lookup: inherited passes are not news.
    const batch = await e.hook("post-tool-batch", wt2, { session_id: OTHER_SESSION });
    expect(batch).toMatchObject({ code: 0, stdout: "", stderr: "" });

    // A session that starts now registers against the inherited state.
    const later = await e.hook("session-start", wt2, { session_id: "late-session" });
    expect(later.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expectAgrees(later.text, await e.status(wt2));
  }, 240_000);

  // Goal 4: inherited results are reported as inherited, and D9's skill reads
  // "the header's pending and inherited counts" (StatusHeader.inheritedCount).
  it("names inherited results in the registration it delivers", async (ctx) => {
    const e = fixture(ctx);
    const { wt2 } = await twoWorktrees(e);
    const later = await e.hook("session-start", wt2, { session_id: "late-session" });
    expect(later.text).toContain("registered at revision");
    expect(later.text).toMatch(/inherited/i);
  }, 240_000);

  // A consumer registered before the lookup was never told the inherited
  // pass, yet Squeal observed it (goal 3: what the agent is told is true), so
  // the delta reads PASS -> FAIL from the prior known state, not "first
  // observed: FAIL".
  it("calls a break of an inherited pass PASS -> FAIL before any tool boundary", async (ctx) => {
    const e = fixture(ctx);
    const { wt2 } = await twoWorktrees(e);
    await e.edit(wt2, "strings", STRINGS("?"), (s) => s.knownFailures.length === 1);
    const delivered = await e.hook("post-tool-batch", wt2, { session_id: OTHER_SESSION });
    expect(delivered.text).toContain("FAIL  test/strings.test.ts > shouts\n      PASS -> FAIL");
  }, 240_000);

  it("runs only the affected files of an edit there and tells the first worktree nothing", async (ctx) => {
    const e = fixture(ctx);
    const { main, wt2 } = await twoWorktrees(e);
    const registered = await e.hook("post-tool-batch", e.main);
    expect(registered.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    const mainRuns = e.runs(e.main).length;
    // A tool boundary after the lookup: the inherited passes enter the view silently (D6).
    const seen = await e.hook("post-tool-batch", wt2, { session_id: OTHER_SESSION });
    expect(seen).toMatchObject({ code: 0, stdout: "" });

    const broken = await e.edit(wt2, "strings", STRINGS("?"), (s) => s.knownFailures.length === 1);
    const runs = e.runs(wt2);
    expect(runs.length).toBeGreaterThan(0);
    expect(new Set(runs.flatMap((r) => r.testFiles))).toEqual(new Set(["test/strings.test.ts"]));
    expect(runs.every((r) => r.revision === broken.revision)).toBe(true);
    expect(e.runs(e.main)).toHaveLength(mainRuns);

    const delivered = await e.hook("post-tool-batch", wt2, { session_id: OTHER_SESSION });
    expect(delivered.text).toMatch(/^SQUEAL · 1 check changed at revision \d+\n/);
    expect(headerRevision(delivered.text ?? "")).toBe(broken.revision);
    expect(delivered.text).toContain("FAIL  test/strings.test.ts > shouts\n      PASS -> FAIL");
    expectAgrees(delivered.text, await e.status(wt2));

    // The first worktree's consumer and state are untouched.
    const first = await e.hook("post-tool-batch", e.main);
    expect(first).toMatchObject({ code: 0, stdout: "", stderr: "" });
    const after = await e.status(e.main);
    expect(after.revision).toBe(main.revision);
    expect(after.knownFailures).toEqual([]);
    expect(after.counts).toEqual(main.counts);
  }, 240_000);
});
