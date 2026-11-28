import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { namedCode } from "../../src/cli/status-wait-paths.js";
import { lintScope, offKey } from "../../src/core/lint/pass/records.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { keyedAt, lintedRepo, stateOf, wait, writeAt } from "./named-lint-fixture.js";
import { B, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Review 0.1.666 B1 (row 017-37): a named wait counts a saved lint verdict
 * only once its tool keyed the worktree's latest revision and the result
 * was judged at the named file's bytes now. Until then the file is
 * `pending` (`keying`); at the deadline it stays so in the lint field while
 * the test files decide the code and the verdict.
 */

const EDITED = "export const a = missing;\n";

describe("a named wait's lint is fresh or pending (review 0.1.666 B1)", () => {
  it("waits for the edit's lint and reports its fail, not the old pass (the review's regression)", async () => {
    const { repo, lint } = lintedRepo("pass");
    const id = repo.mainId;
    // The old pass, judged at the old bytes at revision 3, and the pass keyed at 3 only.
    lint.states.upsertMany([stateOf(id, B, "pass")]);
    keyedAt(lint, id, 3, "old-environment");
    writeAt(repo.main, B, EDITED);
    const linted = setTimeout(() => {
      lint.states.upsertMany([stateOf(id, B, "fail", EDITED, 4)]);
      keyedAt(lint, id, 4);
    }, 250);
    const got = await wait(repo.main, [B], 5_000);
    clearTimeout(linted);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.waitedMs).toBeGreaterThanOrEqual(200);
    expect(got.lint?.files).toEqual([{ path: B, tool: "eslint", outcome: "fail" }]);
    expect(got.lint).toMatchObject({ done: 1, pending: 0, failing: 1 });
  });

  it("keeps an equal-bytes pass pending while keying is behind a config change, to the deadline", async () => {
    const { repo, lint } = lintedRepo("pass");
    // Revision 4 changed the config; the pass keyed revision 3 only. B's bytes are those judged.
    keyedAt(lint, repo.mainId, 3, "old-environment");
    const got = await wait(repo.main, [B], 300);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.waitedMs).toBeGreaterThanOrEqual(250);
    // The test files decide the outcome and the code; the lint field says it has no verdict.
    expect(got.outcome).toBe("settled");
    expect(namedCode(got)).toBe(0);
    expect(got.lint).toMatchObject({ done: 0, pending: 1, failing: 0, unknown: 0 });
    expect(got.lint?.files).toEqual([
      {
        path: B,
        tool: "eslint",
        outcome: "pending",
        waits: "keying",
        reason: "lint has not keyed revision 4 yet (last keyed at revision 3)",
      },
    ]);
    expect(namedText(got, NOW as EpochMs)).toContain(
      "  src/b.test.ts (eslint): pending: lint has not keyed revision 4 yet (last keyed at revision 3)",
    );
  });

  it("keeps a pass judged at other bytes pending though keying is current", async () => {
    const { repo } = lintedRepo("pass");
    writeAt(repo.main, B, EDITED);
    const got = await wait(repo.main, [B], 300);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.waitedMs).toBeGreaterThanOrEqual(250);
    expect(got.lint?.files[0]).toMatchObject({ outcome: "pending", waits: "keying" });
    expect(got.lint?.files[0]?.reason).toContain("its saved result is of other bytes");
  });

  it("accepts an unchanged file's older result at once", async () => {
    const { repo, lint } = lintedRepo("pass");
    lint.states.upsertMany([stateOf(repo.mainId, B, "pass", undefined, 1)]);
    const got = await wait(repo.main, [B], 5_000);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.waitedMs).toBeLessThan(2_000);
    expect(got.lint?.files).toEqual([{ path: B, tool: "eslint", outcome: "pass" }]);
  });

  it("names a new named file with no check yet as waiting for the keying", async () => {
    const { repo, lint } = lintedRepo("pass");
    keyedAt(lint, repo.mainId, 3);
    writeAt(repo.main, "src/new.ts", EDITED);
    const got = await wait(repo.main, [B, "src/new.ts"], 300);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.lint?.files.map((f) => [f.path, f.outcome, f.waits])).toEqual([
      [B, "pending", "keying"],
      ["src/new.ts", "pending", "keying"],
    ]);
  });

  it("tells an off tool as unknown with why, and does not wait for it", async () => {
    const { repo, lint } = lintedRepo("pass");
    keyedAt(lint, repo.mainId, 3);
    lint.meta.set(offKey(lintScope(repo.mainId, "eslint")), "no ESLint installed in /x");
    const got = await wait(repo.main, [B], 5_000);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.waitedMs).toBeLessThan(2_000);
    expect(got.lint?.files).toEqual([
      {
        path: B,
        tool: "eslint",
        outcome: "unknown",
        reason: "lint is off: no ESLint installed in /x",
      },
    ]);
  });

  it("tells a lint store no daemon made yet as unavailable, never as linted", async () => {
    const { repo } = repoWith([], [B]);
    writeFileSync(join(repo.main, "squeal.config.json"), '{ "lint": { "enabled": true } }\n');
    const got = await wait(repo.main, [B], 5_000);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.lint).toEqual({
      done: 0,
      pending: 0,
      failing: 0,
      unknown: 0,
      files: [],
      unavailable: "no daemon has made the lint store yet",
    });
    expect(namedText(got, NOW as EpochMs)).toContain(
      "Lint of the named files: unavailable: no daemon has made the lint store yet.",
    );
  });
});
