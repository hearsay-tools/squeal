import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { SlowTierState, StatusSnapshot } from "../../src/core/types/index.js";
import { additionalContext, block } from "../../src/harness/codex/output.js";
import { settled } from "../evals/status-snapshot.js";

/*
 * Task 004-76 (`research/slow-tier-role.md` 5): with the declared artifact
 * older than the sources, the `Slow tier:` line says the source changes since
 * are not in it, so its files have not tested them; it names no build command
 * (004-71). The same line on every surface it appears on: `squeal status`, a
 * registration, a change delivery's news and Stop's full block, plain and in
 * a hook's JSON.
 */

const tier = (over: Partial<SlowTierState> = {}): SlowTierState => ({
  testFiles: 2,
  current: 2,
  pending: 0,
  notRun: 0,
  currentAt: 2,
  artifact: ["plugins/**"],
  sourcesChangedSince: true,
  activity: null,
  ...over,
});
const snapshot = (slowTier: SlowTierState): StatusSnapshot => ({ ...settled, slowTier });

const STALE =
  "Slow tier: 2 test files; 2 current against plugins/** as of revision 2; the source changes since are not in it, so these files have not tested them. Squeal runs them when the agent pauses.";
const FRESH =
  "Slow tier: 2 test files; 2 current against plugins/** as of revision 2. Squeal runs them when the agent pauses.";

const surfaces: [string, (s: StatusSnapshot) => string][] = [
  ["status", (s) => formatStatus(s, 2_000 as never)],
  ["registration", (s) => formatRegistration({ header: s, knownFailures: [] } as never)],
  [
    "change delivery",
    (s) => formatDelta({ header: s, entries: [], slowTierChanged: true } as never),
  ],
  [
    "Stop",
    (s) =>
      formatDelta(
        { header: s, entries: [], slowTierChanged: false } as never,
        "squeal",
        undefined,
        "full",
      ),
  ],
];
const wrappings: [string, (text: string) => string][] = [
  ["plain", (text) => text],
  [
    "in a hook's JSON",
    (text) =>
      (
        JSON.parse(JSON.stringify(additionalContext("PostToolUse", text))) as {
          hookSpecificOutput: { additionalContext: string };
        }
      ).hookSpecificOutput.additionalContext,
  ],
  [
    "in a Stop block's JSON",
    (text) => (JSON.parse(JSON.stringify(block(text))) as { reason: string }).reason,
  ],
];
const slowLine = (text: string) => text.split("\n").find((line) => line.startsWith("Slow tier:"));

describe("the Slow tier line says an untested change plainly (task 004-76)", () => {
  for (const [surface, format] of surfaces)
    for (const [wrapped, wrap] of wrappings) {
      it(`says the source changes since are untested on ${surface}, ${wrapped}`, () => {
        expect(slowLine(wrap(format(snapshot(tier()))))).toBe(STALE);
      });

      it(`adds nothing when the sources did not change, on ${surface}, ${wrapped}`, () => {
        expect(slowLine(wrap(format(snapshot(tier({ sourcesChangedSince: false })))))).toBe(FRESH);
      });
    }

  it("names no build command", () => {
    expect(slowLine(formatStatus(snapshot(tier()), 2_000 as never))).not.toMatch(/build|npm/);
  });

  it("says them of several declared artifacts", () => {
    const text = formatStatus(snapshot(tier({ artifact: ["dist/**", "web/dist/**"] })), 0 as never);
    expect(slowLine(text)).toBe(
      "Slow tier: 2 test files; 2 current against 2 declared artifacts as of revision 2; the source changes since are not in them, so these files have not tested them. Squeal runs them when the agent pauses.",
    );
  });

  it("names no artifact the changes are not in when none is known", () => {
    const none = formatStatus(snapshot(tier({ artifact: [] })), 0 as never);
    expect(slowLine(none)).toBe(
      "Slow tier: 2 test files; 2 current at revision 2, against no declared artifact; these files have not tested the source changes since. Squeal runs them when the agent pauses.",
    );
    const unknown = formatStatus(snapshot(tier({ artifact: [], artifactUnknown: 2 })), 0 as never);
    expect(slowLine(unknown)).toBe(
      "Slow tier: 2 test files; 2 current at revision 2, declared artifact unknown; these files have not tested the source changes since. Squeal runs them when the agent pauses.",
    );
  });

  it("keeps the pending files after the clause", () => {
    const text = formatStatus(snapshot(tier({ testFiles: 3, pending: 1 })), 0 as never);
    expect(slowLine(text)).toBe(
      "Slow tier: 3 test files; 2 current against plugins/** as of revision 2; the source changes since are not in it, so these files have not tested them; 1 pending. Squeal runs them when the agent pauses; `squeal run --slow` runs them now.",
    );
  });
});
