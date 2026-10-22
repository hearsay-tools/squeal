import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { YIELD_REMAINDER_MS } from "../../src/core/scheduler/yields.js";
import type { NamedFile } from "../../src/core/status/standing.js";
import { timeText } from "../../src/core/text.js";
import type { TierYield } from "../../src/core/types/index.js";

/*
 * Row 011-103 slice 6 (`quality/2026-10.md`): the group id and the line read
 * a yield's remainder through one `remainderSeconds`, so a file a daemon
 * published at −0.6 s and one at 0 s, which both read "0 s", print as one
 * line; the "30 s" comes from `YIELD_REMAINDER_MS`. Row 011-107: a tier
 * past its estimate names the bound it yields at.
 */

/** A promoted file queued behind the lane's tier running since `behind`, whose yield is `yields`. */
function queued(path: string, yields: TierYield): NamedFile {
  const standing = {
    kind: "queued",
    lane: "vitest",
    behind: 0,
    files: 4,
    promoted: true,
    yields,
  } as const;
  return { testFile: { project: "", path }, state: "pending", pending: standing, standing };
}

describe("a yield's remainder reads one way (row 011-103 slice 6)", () => {
  it("files at −0.6 s and at 0 s print as one line", () => {
    const files = [
      queued("test/a.test.ts", { kind: "remainder", remainderMs: -600 }),
      queued("test/b.test.ts", { kind: "remainder", remainderMs: 0 }),
    ];

    // The first line is the header, `Pending (2):`.
    const [, ...lines] = classLines(files, "squeal");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^ {2}2 queued, promoted, .*; the tier does not yield: its estimated remainder was 0 s, not over 30 s: test\/a\.test\.ts, test\/b\.test\.ts;/,
    );
  });

  it("files whose remainders round to other seconds print apart", () => {
    const files = [
      queued("test/a.test.ts", { kind: "remainder", remainderMs: 9_400 }),
      queued("test/b.test.ts", { kind: "remainder", remainderMs: 10_600 }),
    ];

    const [, ...lines] = classLines(files, "squeal");

    expect(lines.map((l) => /remainder was (\d+) s/.exec(l)?.[1])).toEqual(["9", "11"]);
  });

  it("names the threshold from YIELD_REMAINDER_MS", () => {
    const [, line] = classLines(
      [queued("test/a.test.ts", { kind: "remainder", remainderMs: 5_000 })],
      "squeal",
    );

    expect(line).toContain(`, not over ${YIELD_REMAINDER_MS / 1_000} s:`);
  });

  it("a tier past its estimate names its bound and needs no step; files at one bound share a line", () => {
    const at = Date.UTC(2026, 9, 21, 15, 50, 27);
    const files = [
      queued("test/a.test.ts", { kind: "overrun", yieldsAt: at }),
      queued("test/b.test.ts", { kind: "overrun", yieldsAt: at + 200 }),
      queued("test/c.test.ts", { kind: "overrun", yieldsAt: at + 5_000 }),
    ];

    const [, ...lines] = classLines(files, "squeal");

    const reason = `; the tier has run past its estimate and yields at ${timeText(at)}, 30 s past it`;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`${reason}: test/a.test.ts, test/b.test.ts`);
    expect(lines[0]).not.toContain("no command runs");
    const [first] = files;
    if (first === undefined) throw new Error("no file");
    const entry = fileEntry(first, "squeal");
    expect(entry.reason?.endsWith(reason)).toBe(true);
    expect(entry.next).toBeUndefined();
  });
});
