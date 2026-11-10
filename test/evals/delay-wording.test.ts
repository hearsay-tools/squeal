import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { type EndedWait, waitText } from "../../src/cli/status-wait-lines.js";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { statusText } from "../../src/harness/shared/text.js";
import { settled } from "./status-snapshot.js";

/*
 * Row 011-311 (the human, 2026-11-10): the two delays the counts can leave out, in the human's
 * words. The runner has not listed the revision's test files (`Vitest has not yet listed the test
 * files of revision 3`), Squeal has not read the newest edits (`Squeal has not yet read edits
 * made after …`), or both (`Squeal is behind: …`). The parser reads each from the product's own
 * formatters, as text and in a Claude Code hook's JSON: a revision not listed is never a pass,
 * and a late feed alone reads as it read before the row.
 */

const LATE = { state: "alive", lastHeartbeatAt: 1_000, late: { since: 500 } } as const;
const unlisted = (runners: readonly string[]): Partial<StatusSnapshot> => ({
  runnerPartPending: true,
  refinedRevision: 2,
  listingRunners: runners,
});
const delays: [string, StatusSnapshot, { unlisted: boolean; words: RegExp }][] = [
  [
    "a revision not listed",
    { ...settled, ...unlisted(["Vitest"]) },
    { unlisted: true, words: /Vitest has not yet listed the test files of revision 3/ },
  ],
  [
    "a revision two runners have not listed",
    { ...settled, ...unlisted(["Vitest", "pytest"]) },
    { unlisted: true, words: /Vitest and pytest have not yet listed the test files of revision 3/ },
  ],
  [
    "a late change feed",
    { ...settled, daemon: LATE },
    { unlisted: false, words: /Squeal has not yet read edits made after / },
  ],
  [
    "both",
    { ...settled, ...unlisted(["Vitest"]), daemon: LATE },
    { unlisted: true, words: /Squeal is behind: it has not read edits made after / },
  ],
];

const status = (s: StatusSnapshot) => formatStatus(s, 2_000 as never);
const header = (s: StatusSnapshot) =>
  formatRegistration({ header: s, knownFailures: s.knownFailures } as never);
const stop = (s: StatusSnapshot) => statusText(s, s.knownFailures);
const news = (s: StatusSnapshot) => formatDelta({ header: s, entries: [] } as never);
/** A timed-out `status --wait`: the status, then its verdict line last (011-10). */
const timedOut = (s: StatusSnapshot) =>
  waitText(
    { outcome: "timeout", waitedMs: 1_000, transitions: 0, result: s } as EndedWait,
    2_000 as never,
  );
const formatters = [
  ["status", status, "pull"],
  ["registration's header", header, "push"],
  ["Stop's status text", stop, "push"],
  ["change delivery's news header", news, "push"],
  ["timed-out status --wait", timedOut, "pull"],
] as const;
const wrappings = [
  ["as text", (t: string) => t],
  [
    "in a Claude Code hook's JSON",
    (t: string) =>
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: t },
      }),
  ],
] as const;

describe("the delays the counts leave out, as the evals parser reads them (row 011-311)", () => {
  for (const [name, s, want] of delays)
    for (const [form, format, from] of formatters)
      for (const [wrapped, wrap] of wrappings)
        it(`reads ${name} in a ${form}, ${wrapped}`, () => {
          const text = format(s);
          expect(text).toMatch(want.words);
          expect(text).not.toMatch(/runner part|may not be seen|current as of revision/);
          const e = squealEvidence(wrap(text), from, 0);
          const before = squealEvidence(wrap(format(settled)), from, 0);
          expect(e).toMatchObject({ revision: 3, daemon: true });
          if (want.unlisted) {
            expect(e?.pending).toBeGreaterThan(0);
            expect(e?.verdict).not.toBe("pass");
          } else {
            expect(e?.pending).toBe(before?.pending);
            expect(e?.verdict).toBe(before?.verdict);
          }
        });

  for (const [name, s, want] of delays)
    for (const [wrapped, wrap] of wrappings)
      it(`reads ${name} from a timed-out wait's verdict line alone, ${wrapped}`, () => {
        const line = timedOut(s).trimEnd().split("\n").at(-1) ?? "";
        const e = squealEvidence(wrap(line), "pull");
        expect(e?.pending).toEqual(expect.any(Number));
        if (want.unlisted) expect(e?.verdict).not.toBe("pass");
      });
});
