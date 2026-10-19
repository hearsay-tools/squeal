import { describe, expect, it } from "vitest";
import { readHeader, slowAffectedText } from "../../src/core/state/index.js";
import {
  FAST,
  keys,
  SLOW_A,
  SLOW_B,
  SLOW_C,
  SLOW_D,
  SLOW_POLICY,
  seed,
  slowLine,
  states,
  status,
} from "./slow-tier-seed.js";

/*
 * Spec 004 D8 as amended 2026-10-19 (row 004-83): the `Affected checks`
 * headline names the slow files among its running and queued work, a few by
 * path and the rest by count, and `squeal run --slow --wait 60000` as the
 * wait for their results, under either `stop.requireSlowSuite`; the
 * `Slow tier:` line ends with that wait under either policy.
 */

const WAIT = "`squeal run --slow --wait 60000`";
const POLICIES = [
  ["off", SLOW_POLICY],
  ["on", { ...SLOW_POLICY, stop: { requireSlowSuite: true } }],
] as const;

const affectedLine = (text: string) => text.split("\n").find((l) => l.startsWith("Affected"));

/** `paths` slow files with one check each, running, and the fast file passed. */
function running(policy: object, paths: readonly string[]) {
  const s = seed(policy);
  const pending = { validity: "pending", pendingPhase: "running", observedAt: null } as const;
  states(s.store, s.repo, [...paths.map(() => pending), { observedAt: 2 }], [...paths, FAST]);
  keys(s.store, s.repo, Object.fromEntries(paths.map((p) => [p, "running" as const])));
  return s;
}

describe("the Affected checks headline names the slow files among them (row 004-83)", () => {
  for (const [name, policy] of POLICIES) {
    it(`names three by path and counts the rest, policy ${name}`, () => {
      const s = running(policy, [SLOW_D, SLOW_B, SLOW_A, SLOW_C]);
      expect(readHeader(s.store, s.repo.mainId).slowPending).toMatchObject({
        testFiles: 4,
        files: [SLOW_A, SLOW_B, SLOW_C].map((path) => ({ project: "", path })),
      });
      const text = status(s);
      expect(affectedLine(text)).toBe(
        `Affected checks: 1 passed (1 test), 4 running (4 tests), 0 queued; among them 4 slow test files, ${SLOW_A}, ${SLOW_B}, ${SLOW_C} and 1 more: ${WAIT} waits for their results`,
      );
      expect(slowLine(text)).toMatch(new RegExp(`; ${literal(WAIT)} waits for their results\\.$`));
    });

    it(`names one slow file and its result, policy ${name}`, () => {
      const text = status(running(policy, [SLOW_A]));
      expect(affectedLine(text)).toBe(
        `Affected checks: 1 passed (1 test), 1 running (1 test), 0 queued; among them 1 slow test file, ${SLOW_A}: ${WAIT} waits for its result`,
      );
      // The seed lists SLOW_B too, not run: the line counts two not current.
      expect(slowLine(text)).toMatch(new RegExp(`; ${literal(WAIT)} waits for their results\\.$`));
    });
  }

  it("names none when no slow file is pending", () => {
    const s = seed();
    const current = [{ observedAt: 2 }, { observedAt: 2 }, { observedAt: 2 }];
    states(s.store, s.repo, current, [SLOW_A, SLOW_B, FAST]);
    const text = status(s);
    expect(affectedLine(text)).toBe("Affected checks: 3 passed (3 tests), 0 running, 0 queued");
    expect(slowLine(text)).not.toContain("--wait");
  });

  it("names a project's file with its project, and counts alone a header read before the paths", () => {
    const files = [
      { project: "e2e", path: SLOW_A },
      { project: "", path: SLOW_B },
    ];
    expect(
      slowAffectedText({ testFiles: 2, checks: 2, testFilesWithoutChecks: 0, files }, "sq"),
    ).toBe(
      `; among them 2 slow test files, e2e: ${SLOW_A} and ${SLOW_B}: \`sq run --slow --wait 60000\` waits for their results`,
    );
    expect(slowAffectedText({ testFiles: 2, checks: 2, testFilesWithoutChecks: 0 }, "sq")).toBe(
      "; among them 2 slow test files: `sq run --slow --wait 60000` waits for their results",
    );
  });
});

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
