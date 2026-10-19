import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { publishSlowEvidence } from "../../src/core/slow/rank-store.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { CheckKey, TestFileKeyRecord } from "../../src/core/types/index.js";
import { fakeRepo, seedStore } from "./helpers.js";
import { reportOf, seedLogin } from "./why-seed.js";

/*
 * Spec 004 D2 as amended 2026-10-18 (task 004-82): "`why <slow file>` names
 * the tokens that ranked it", from the row the daemon publishes, while that
 * row is at the file's current key.
 */
describe("why names the tokens that ranked a slow file (004 D2, task 004-82)", () => {
  const SPEC = "e2e/artifact-project-links.e2e.ts";
  const row = (worktreeId: string, path: string, key: string): TestFileKeyRecord => ({
    worktreeId,
    testFile: { project: "", path },
    key,
    revision: 2,
    pending: "queued",
  });
  const tokens = ["link-safety-dialog", "link-safety-url"];

  function seeded(key: string) {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);
    store.testFileKeys.upsertMany([row(b.id, SPEC, "k-spec"), row(b.id, "src/auth.test.ts", "k1")]);
    publishSlowEvidence(
      store,
      b.id,
      new Map([
        [testFileId({ project: "", path: SPEC }), { key: key as CheckKey, tokens }],
        [testFileId({ project: "", path: "src/auth.test.ts" }), { key: "k1" as CheckKey, tokens }],
      ]),
    );
    return b;
  }

  it("names them for a slow file with no check yet, by its path or the end of it", () => {
    const b = seeded("k-spec");
    for (const query of [SPEC, "artifact-project-links.e2e.ts"]) {
      const why = readWhy(b.root, query);
      expect(why).toMatchObject({ found: false, rankedBy: { testFile: SPEC, tokens } });
      expect(formatWhy(why)).toContain(
        `Slow order: ${SPEC} runs ahead by evidence: it selects link-safety-dialog, link-safety-url, tokens of the files edited\n`,
      );
    }
  });

  it("names them in a check's report", () => {
    const b = seeded("k-spec");
    const report = reportOf(readWhy(b.root, "auth > login"));
    expect(report.rankedBy).toEqual({ testFile: "src/auth.test.ts", tokens });
    expect(formatWhy(report)).toContain("  Slow order: src/auth.test.ts runs ahead by evidence");
  });

  it("says nothing once the file's key moved past the ranked one", () => {
    const b = seeded("k-older");
    const why = readWhy(b.root, SPEC);
    expect(why).not.toHaveProperty("rankedBy");
    expect(formatWhy(why)).not.toContain("Slow order");
  });
});
