import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estimateLine,
  estimateSide,
  MEASURED_LEAST,
  oneGroup,
  readPoolView,
  sideText,
  widthsOf,
} from "../../src/cli/status-at-estimate.js";
import { writeMark } from "../../src/core/capacity/marks.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-49 (dogfood round 6, V2): the estimate of what still runs, per
 * side. Round 6 told "about 3 to 11 min, up to 11 at once" for 1,338 files
 * that took about an hour: the width was the machine's CPUs, while the
 * commit daemon, the worktree's daemon and other sessions' daemons shared
 * one pool of 11 permits on a loaded host.
 */

const files = (n: number, seconds: number | null) => Array.from({ length: n }, () => seconds);
const BOTH = [
  { id: "commit-tree", want: 1338 },
  { id: "worktree", want: 1330 },
];

describe("the estimate per side (row 023-49, V2)", () => {
  it("divides the pool among the daemons with work, as the pool does: round 6's three sessions", () => {
    // Two other sessions' daemons, two each, want work beside this call's two sides.
    const others = ["a", "b", "c", "d"].map((id) => ({ id, want: 1000, since: null }));
    expect(widthsOf({ slots: 11, others }, BOTH).every((w) => w <= 2)).toBe(true);
    // Alone, the two sides share the 11 permits.
    expect(widthsOf({ slots: 11, others: [] }, BOTH)).toEqual([6, 5]);
    // A side with nothing to run takes no share and counts 1.
    const one = [
      { id: "commit-tree", want: 50 },
      { id: "worktree", want: 0 },
    ];
    expect(widthsOf({ slots: 11, others: [] }, one)).toEqual([11, 1]);
  });

  it("from stored durations: round 6's 1,338 files at 2 s are about 36 min, not about 4", () => {
    const e = estimateSide({ groups: [oneGroup(files(1338, 2))], measured: null }, 2, 1.6);
    // The old rule: 1,338 x 2 s over 11 at once, no load: 244 s.
    expect(e).toMatchObject({ files: 1338, width: 2, basis: "durations", known: 1338, load: 1.6 });
    expect(e?.seconds).toBe(Math.ceil(1338 * 1.6));
    expect(e === null ? "" : sideText(e)).toBe(
      "about 36 min for 1338 test files, up to 2 at once, from their stored durations, times 1.6 for the host's load per CPU",
    );
  });

  it("prefers this call's measured rate once it saw enough results there", () => {
    const measured = { done: 90, ms: 98_000 };
    const e = estimateSide({ groups: [oneGroup(files(1248, 2))], measured }, 2, 1.6);
    expect(e).toMatchObject({ basis: "measured", seconds: Math.ceil((1248 * 98) / 90) });
    expect(e === null ? "" : sideText(e)).toBe(
      "about 23 min for 1248 test files, at this call's rate there (90 results in 98 s)",
    );
    // Too few results: the stored durations decide.
    const few = { done: MEASURED_LEAST - 1, ms: 98_000 };
    const fallback = estimateSide({ groups: [oneGroup(files(100, 2))], measured: few }, 2, null);
    expect(fallback?.basis).toBe("durations");
  });

  it("says when it is a guess, and when the time is unknown", () => {
    const guess = estimateSide(
      { groups: [oneGroup([10, 10, ...files(8, null)])], measured: null },
      2,
      null,
    );
    expect(guess).toMatchObject({ basis: "guess", known: 2, seconds: 50 });
    expect(guess === null ? "" : sideText(guess)).toBe(
      "about 50 s for 10 test files, up to 2 at once; a guess: 2 of them have a stored duration, the others count at their median",
    );
    const unknown = estimateSide({ groups: [oneGroup(files(10, null))], measured: null }, 2, null);
    expect(unknown).toMatchObject({ basis: "unknown", seconds: null, known: 0 });
    expect(unknown === null ? "" : sideText(unknown)).toBe(
      "10 test files, time unknown: none has a stored duration and this call measured no rate",
    );
    expect(estimateSide({ groups: [oneGroup([])], measured: null }, 2, null)).toBeNull();
  });

  it("names each side, and how to narrow a wide call", () => {
    const at = estimateSide({ groups: [oneGroup(files(1338, 3))], measured: null }, 3, null);
    const now = estimateSide({ groups: [oneGroup(files(4, 30))], measured: null }, 3, null);
    const narrow = "squeal status --at HEAD~1 <path>... --run";
    expect(estimateLine({ commit: at, now }, "a5c9b7223", narrow)).toBe(
      "Still to run, at a5c9b7223: about 22 min for 1338 test files, up to 3 at once, from their stored durations; in the working tree: about 40 s for 4 test files, up to 3 at once, from their stored durations; name test files or folders to narrow it: squeal status --at HEAD~1 <path>... --run",
    );
    expect(estimateLine({ commit: null, now: null }, "a5c9b7223", null)).toBeNull();
    expect(estimateLine({ commit: null, now }, "a5c9b7223", null)).toBe(
      "Still to run, in the working tree: about 40 s for 4 test files, up to 3 at once, from their stored durations",
    );
  });

  it("reads the pool's slots and the other daemons' fresh marks with work", () => {
    const runtime = mkdtempSync(join(tmpdir(), "squeal-pool-")) as AbsolutePath;
    try {
      const dir = join(runtime, "squeal") as AbsolutePath;
      const config = join(runtime, "config");
      const env = { XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: config, HOME: runtime };
      expect(readPoolView(env, []).others).toEqual([]);
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(config, "squeal"), { recursive: true });
      writeFileSync(join(config, "squeal", "config.json"), '{"capacity":{"hostSlots":3}}');
      writeMark(dir, { id: "other", want: 4, grant: 2, since: null });
      writeMark(dir, { id: "idle", want: 0, grant: 0, since: null });
      writeMark(dir, { id: "mine", want: 9, grant: 1, since: null });
      const view = readPoolView(env, ["mine"]);
      expect(view.slots).toBe(3);
      expect(view.others.map((d) => d.id)).toEqual(["other"]);
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  });
});
