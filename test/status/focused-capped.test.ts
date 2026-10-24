import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { focusedRun, NOW, PARITY, seedFile, worktree, writeRuns } from "./focused-fixture.js";

/*
 * Row 011-146 (011 C6 as amended 2026-10-23; review 0.1.286 B2): the
 * status line of an entry past its 50 kept checks. A row that counts every
 * outcome gives exact totals; one without the count names the kept checks
 * and the rest it did not keep, never a complete pass.
 */

const goods = (n: number) => Array.from({ length: n }, (_, i) => `good ${i}`);

function focusedLineOf(run: ReturnType<typeof focusedRun>): string | undefined {
  const { repo, store, id } = worktree();
  seedFile(store, id, PARITY, "queued");
  writeRuns(store, id, [run]);
  const status = readStatus(repo.main, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return formatStatus(status, NOW)
    .split("\n")
    .find((l) => l.startsWith("Focused (not counted):"));
}

describe("the status line past 50 kept checks (review 0.1.286 B2)", () => {
  it("a row without a count says what it kept and what it did not", () => {
    const line = focusedLineOf(
      focusedRun(PARITY, { fails: [], passes: goods(50), more: 1, matched: 51 }),
    );

    expect(line).toBe(
      `Focused (not counted): ${PARITY} at revision 4: 0 of the 50 kept of 51 selected checks FAIL; 1 more not kept; its own run is queued.`,
    );
  });

  it("a counted row: the fail past the cut, and more than 50 fails, exactly", () => {
    const one = focusedLineOf(
      focusedRun(PARITY, {
        fails: ["bad"],
        passes: goods(49),
        more: 1,
        matched: 51,
        outcomes: { pass: 50, fail: 1, skip: 0 },
      }),
    );
    const sixty = focusedLineOf(
      focusedRun(PARITY, {
        fails: goods(50),
        more: 10,
        matched: 60,
        outcomes: { pass: 0, fail: 60, skip: 0 },
      }),
    );

    expect(one).toMatch(/: 1 of 51 selected checks FAIL \(bad\); its own run is queued\.$/);
    expect(sixty).toMatch(
      /: 60 of 60 selected checks FAIL \(good 0, good 1, good 2 and 57 more\); its own run is queued\.$/,
    );
  });
});
