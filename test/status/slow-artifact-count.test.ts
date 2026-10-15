import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { NOW, ran, SLOW_A, SLOW_B, SLOW_POLICY, seed, slowLine, states } from "./slow-tier-seed.js";

/*
 * Task 001-413: cezar's slow-tier line listed all 25 declared artifact globs.
 * Several are counted; `status --json` and `status --notes` hold the list.
 */

const GLOBS = Array.from({ length: 25 }, (_, i) => `packages/package-${i}/dist/**`);

function read(globs: string[]) {
  const s = seed(SLOW_POLICY, { revisions: 2, changes: ["plugins/a.js"] });
  states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
  ran(s.store, s.repo, [SLOW_A, SLOW_B], globs);
  s.store.close();
  return readStatus(s.repo.main, { now: () => NOW });
}

describe("the slow-tier line's declared artifacts (001-413)", () => {
  it("counts 25 artifacts in under 200 characters; --json and --notes list them", () => {
    const result = read(GLOBS);
    const line = slowLine(formatStatus(result, NOW)) ?? "";
    expect(line).toBe(
      "Slow tier: 2 test files; 2 current against 25 declared artifacts as of revision 2. Squeal runs them when the agent pauses.",
    );
    expect(line.length).toBeLessThan(200);

    expect(result.available && result.slowTier?.artifact).toEqual([...GLOBS].sort());
    const notes = formatStatus(result, NOW, "squeal", { allNotes: true }).split("\n");
    expect(notes[notes.indexOf(line) + 1]).toBe(
      `  Declared artifacts: ${[...GLOBS].sort().join(", ")}`,
    );
  });

  it("names a single artifact, and lists nothing more under --notes", () => {
    const result = read(["dist/**"]);
    const text = formatStatus(result, NOW, "squeal", { allNotes: true });
    expect(slowLine(text)).toBe(
      "Slow tier: 2 test files; 2 current against dist/** as of revision 2. Squeal runs them when the agent pauses.",
    );
    expect(text).not.toContain("Declared artifacts:");
  });
});
