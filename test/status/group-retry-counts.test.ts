import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupTierLines, readHeader } from "../../src/core/state/index.js";
import { CODEX } from "../harness/primer-helpers.js";
import { keys, SLOW_A, SLOW_B, SLOW_POLICY, seed, states, status } from "./slow-tier-seed.js";

/*
 * Row 019-24 item 4 (review 0.1.397 S2): a configured group's file whose
 * current failure is queued or running again at the same key, as a retry
 * is, counts pending in the group's line, as the header's test file counts
 * class it (`fileClassOf`): one classification for both. The default
 * `slow` group keeps its classifier, so the texts without `checks` and
 * Stop's reading are as before.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-group-retry-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

const E2E_POLICY = {
  checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
};

/** `SLOW_A` failing and current, then queued or running again at its key; `SLOW_B` passing. */
function retried(policy: object, phase: "queued" | "running") {
  const s = seed(policy);
  states(
    s.store,
    s.repo,
    [
      { outcome: "fail", observedAt: 2 },
      { outcome: "pass", observedAt: 2 },
    ],
    [SLOW_A, SLOW_B],
  );
  keys(s.store, s.repo, { [SLOW_A]: phase, [SLOW_B]: null });
  return s;
}

describe("a group's counts class a same-key retry as the header does (019-24 item 4)", () => {
  it.each(["queued", "running"] as const)(
    "a %s retry counts pending in the group's line",
    (phase) => {
      const s = retried(E2E_POLICY, phase);
      const header = readHeader(s.store, s.repo.mainId);
      expect(header.testFileCounts?.pending).toBe(1);
      expect(header.groupTiers?.[0]).toMatchObject({
        testFiles: 2,
        current: 1,
        pending: 1,
        notRun: 0,
      });
      const [line] = groupTierLines(header, "squeal");
      expect(line).toMatch(/^e2e: 2 test files; 1 current at revision 2; 1 pending/);
      expect(line).toContain("`squeal run e2e --wait 60000`");
      // Codex names the CLI by its path; the counts read the same.
      expect(groupTierLines(header, CODEX)).toEqual([
        line?.replace("`squeal run", `\`${CODEX} run`),
      ]);
      expect(status(s).split("\n")).toContain(line);
    },
  );

  it("keeps the default slow group's reading without a checks key", () => {
    const s = retried(SLOW_POLICY, "queued");
    const header = readHeader(s.store, s.repo.mainId);
    expect(header.testFileCounts?.pending).toBe(1);
    expect(header.groupTiers).toBeUndefined();
    expect(header.slowTier).toMatchObject({ testFiles: 2, current: 2, pending: 0 });
  });
});
