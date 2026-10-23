import { describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { withheldForTouch } from "../../src/core/scheduler/stability.js";
import { SUMMARY_MAX_CHARS } from "../../src/core/state/index.js";
import type { Delta, RunReport, TransitionEntry } from "../../src/core/types/index.js";
import { withoutFiles, withoutTouched } from "../../src/runners/vitest/moved.js";
import { WorktreePaths } from "../../src/runners/vitest/paths.js";

/*
 * Task 011-02 (gh-13): a reason that names many paths says why first, then
 * the count, a sample and "N more", then every path. The delivery cuts it at
 * `SUMMARY_MAX_CHARS`, so the explanation and the total survive the cut, and
 * the UNKNOWN block names the command that prints it whole. Sized like the
 * issue's 31,065-character failure (research issue-13, probe format.probe.ts).
 */

const TEST = "packages/web/src/test/card-2-contrast.test.ts";
const FILE = { project: "", path: TEST };
const ARTIFACTS = Array.from(
  { length: 660 },
  (_, i) => `packages/cezar/dist/agent-config/module-${i}.d.ts`,
);
const EMPTY: RunReport = {
  end: "completed",
  durationMs: 548_688,
  completedFiles: [FILE],
  results: [],
  fileErrors: [],
  failure: null,
};
const PATHS = new WorktreePaths("/repo");

/** Each builder's reason as the daemon stores it, the composite's prefix on the adapter's. */
const REASONS = {
  "001-159": `vitest: ${withoutTouched(EMPTY, [FILE], ARTIFACTS).failure}`,
  "001-146": `vitest: ${
    withoutFiles(
      EMPTY,
      [FILE],
      ARTIFACTS.map((p) => `/repo/${p}`),
      PATHS,
    ).failure
  }`,
  "001-168": withheldForTouch(EMPTY, ARTIFACTS).failure ?? "",
} as const;

function delta(reason: string): Delta {
  const entries: TransitionEntry[] = Array.from({ length: 7 }, (_, i) => ({
    check: { kind: "test", project: "", testPath: TEST, fullName: `contrast > case ${i}` },
    kind: "to-unknown",
    from: "pass",
    to: "unknown",
    validity: "unknown",
    observedAt: 44,
    origin: { kind: "own" },
    summary: reason,
    location: null,
  }));
  return {
    schemaVersion: 1,
    consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
    header: {
      revision: 44,
      counts: { current: 0, pending: 0, stale: 0, unknown: 7 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
    },
    label: "transitions",
    entries,
  };
}

describe("an unknown reason naming 660 paths (task 011-02)", () => {
  for (const [task, reason] of Object.entries(REASONS)) {
    it(`says why, the total and a sample within the cap (task ${task})`, () => {
      expect(reason.length).toBeGreaterThan(SUMMARY_MAX_CHARS);
      const text = formatDelta(delta(reason));
      const shown = text.split("\n").find((line) => line.includes("no check key names"));

      expect(shown).toBeDefined();
      expect(shown?.trim().length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
      expect(shown).toMatch(
        /^\s+(vitest: vitest adapter|squeal): the run may have executed bytes no check key names, since 660 files /,
      );
      expect(shown).toContain(`(task ${task}): ${ARTIFACTS[0]}, `);
      expect(text).toContain(
        "Full reason: squeal why 'packages/web/src/test/card-2-contrast.test.ts > contrast > case 0'",
      );
    });

    it(`keeps every path in the stored reason, the sample and "N more" first (task ${task})`, () => {
      expect(reason).toContain(`${ARTIFACTS.slice(0, 5).join(", ")} and 655 more; every path: `);
      expect(reason.endsWith(`every path: ${ARTIFACTS.join(", ")}`)).toBe(true);
    });
  }

  it("names up to five paths in place, as before", () => {
    const reason = withoutTouched(EMPTY, [FILE], ARTIFACTS.slice(0, 2)).failure ?? "";
    expect(reason).toBe(
      `vitest adapter: the run may have executed bytes no check key names, since ${ARTIFACTS[0]}, ${ARTIFACTS[1]} were written during this run and ended as they were (task 001-159)`,
    );
  });
});
