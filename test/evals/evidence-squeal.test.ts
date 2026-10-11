import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

// D4 "Retained evidence": the evidence a Squeal text carries, read from the product's own
// wording (`squeal status` and a delivered header), so a change to that wording shows here.

const status = (s: StatusSnapshot) => formatStatus(s, 2_000 as never);
const header = (s: StatusSnapshot) =>
  formatRegistration({ header: s, knownFailures: s.knownFailures } as never);
const failure = {
  check: { project: "", testPath: "test/money.test.ts", name: ["money", "formats"] },
  outcome: "fail",
  validity: "current",
  observedAt: 3,
  summary: "",
  fingerprint: "f",
  location: null,
} as unknown as StatusSnapshot["knownFailures"][number];
const variants: [string, StatusSnapshot, object][] = [
  ["settled", settled, { pending: 0, stale: 0, unknown: 0, verdict: "pass" }],
  [
    "pending",
    {
      ...settled,
      counts: { ...settled.counts, pending: 2 },
      breakdown: { ...settled.breakdown, pendingByPhase: { queued: 1, running: 1 } },
    },
    { pending: 2, verdict: "unknown" },
  ],
  [
    "stale and unknown",
    {
      ...settled,
      counts: { ...settled.counts, stale: 1, unknown: 1 },
    },
    { stale: 1, unknown: 1, verdict: "unknown" },
  ],
  [
    "known failure",
    { ...settled, knownFailures: [failure] },
    { failures: 1, verdict: "fail", failing: ["test/money.test.ts"] },
  ],
  [
    "no daemon",
    { ...settled, daemon: { state: "down", since: null } } as unknown as StatusSnapshot,
    { daemon: false, verdict: "unknown" },
  ],
];

describe("squealEvidence", () => {
  for (const [name, s, want] of variants) {
    it(`reads a ${name} status`, () => {
      expect(squealEvidence(status(s), "pull")).toMatchObject({ revision: 3, ...want });
    });
    it(`reads a ${name} delivered header`, () => {
      const { failing: _, ...rest } = want as { failing?: string[] };
      expect(squealEvidence(header(s), "push")).toMatchObject({ revision: 3, ...rest });
    });
  }

  it("is not current before the daemon listed the test files", () => {
    const e = squealEvidence(header({ ...settled, testFilesListed: false }), "push");
    expect(e?.verdict).toBe("unknown");
  });

  it("tracks failures across deliveries that name only what changed", () => {
    const fail =
      "SQUEAL · 1 check changed at revision 4\nRevision 4: 31 current, 0 pending, 0 stale, 0 unknown.\n\nFAIL  test/a.test.ts > a";
    const pass =
      "SQUEAL · 1 check changed at revision 5\nRevision 5: 31 current, 0 pending, 0 stale, 0 unknown.\n\nPASS  test/a.test.ts > a\n    FAIL -> PASS";
    const failed = squealEvidence(fail, "push", 0);
    expect(failed).toMatchObject({ failures: 1, verdict: "fail", files: ["test/a.test.ts"] });
    expect(squealEvidence(pass, "push", 1)).toMatchObject({ failures: 0, verdict: "pass" });
  });

  it("carries no evidence in a text without a revision or counts", () => {
    expect(squealEvidence("Squeal runs this repository's Vitest tests", "push")).toBeNull();
  });
});
