import { describe, expect, it } from "vitest";
import {
  arrival,
  noResultYet,
  pending,
  resultsOf,
  rowOf,
  watched,
} from "./status-at-arrival-kit.js";
import { run } from "./status-at-kit.js";

/*
 * Row 023-76 (review 0.1.611-rereview N1; review 0.1.611 B1, row 023-70):
 * a folder-listing result that arrives after the commit daemon selected the
 * file (`status-at-arrival-kit.ts`). The caller's run listed an ignored
 * `extra.log` beside the commit's one tracked name, so its key holds that
 * name and the pristine commit's does not: the caller's pass never stands
 * at the commit's key, and the commit's own run fails there. The call reads
 * "fail -> pass", never "unchanged" or the caller's pass at the commit, and
 * the caller's stored pass stays. Before the fix, with the read recorded
 * earlier (`seeded`), the commit side read the caller's pass, then 023-70
 * refused it as not comparable; with no earlier record (N1), the commit's
 * failure replaced the caller's pass at one shared key: "fail -> fail,
 * unchanged".
 */

describe("a folder-listing result that arrives after selection (row 023-76)", {
  timeout: 240_000,
}, () => {
  it.each([
    ["recorded before both runs", true],
    ["first observed by each run (N1)", false],
  ])("reads fail -> pass in the --run call that waits, the folder read %s", async (_, seeded) => {
    const arrived = await arrival(seeded);
    const { f, a, live } = arrived;
    const seen = { before: false };
    const out = await run(
      f,
      {
        commit: a,
        paths: ["test/lists.test.ts"],
        run: { allMissing: false },
        json: true,
        waitMs: 120_000,
      },
      { cacheRoot: f.cacheRoot, daemons: watched(arrived, seen, true) },
    );
    const row = rowOf(out.out);
    expect(seen.before, "the commit selected the file before any result was stored").toBe(true);
    expect(row?.now.state, out.err).toBe("pass");
    expect(row?.at.state, "a pristine commit lists one name; the caller's run listed two").toBe(
      "fail",
    );
    expect(out.code).toBe(0);
    // The caller's pass stays at its own key, which is not the commit's; the commit's run wrote its own.
    const caller = resultsOf(f, live[0]);
    const commit = resultsOf(f, live[1]);
    expect(caller.key).not.toBe(commit.key);
    const tests = (at: ReturnType<typeof resultsOf>) =>
      at.results
        .filter((r) => r.check.kind === "test")
        .map((r) => [r.outcome, r.provenance.worktreeId]);
    expect(tests(caller)).toEqual([["pass", live[0]?.worktreeId]]);
    expect(tests(commit)).toEqual([["fail", live[1]?.worktreeId]]);
  });

  it("reads the commit's own failure in a --wait that joins the queued ask after the caller's pass arrived", async () => {
    const arrived = await arrival(true);
    const { f, a, live } = arrived;
    const seen = { before: false };
    const daemons = watched(arrived, seen);
    // The `--run` call ends at its wait while its ask is queued behind the caller's run.
    const first = await run(
      f,
      {
        commit: a,
        paths: ["test/lists.test.ts"],
        run: { allMissing: false },
        json: true,
        waitMs: 20_000,
      },
      { cacheRoot: f.cacheRoot, daemons },
    );
    expect(seen.before).toBe(true);
    expect(rowOf(first.out)?.at.state).toBe("no result");
    // The caller's pass arrives at its own key; the commit's file still has none.
    arrived.open();
    await expect.poll(() => pending(f, live[0]), { timeout: 60_000 }).toBeNull();
    expect(noResultYet(f, live[1])).toBe(true);
    const joined = await run(
      f,
      { commit: a, paths: ["test/lists.test.ts"], json: true, waitMs: 60_000 },
      { cacheRoot: f.cacheRoot, daemons },
    );
    expect(rowOf(joined.out)?.at.state, joined.err).toBe("fail");
    expect(rowOf(joined.out)?.now.state).toBe("pass");
    expect(joined.code).toBe(0);
  });
});
