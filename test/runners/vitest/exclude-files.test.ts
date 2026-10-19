import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Spec 004 D7 as amended 2026-10-18 (task 004-81): `vitest.exclude`, test-file
 * globs from the worktree root. An excluded file is listed nowhere, so the
 * scheduler never keys, runs or counts it; an import it shares with listed
 * files affects only those. The fixture's `e2e` project stands for a suite of
 * a build output Squeal does not produce.
 */

const FOUR: TestFileRef[] = [
  { project: "api-client", path: "test/api-client.test.ts" },
  { project: "contract", path: "test/contract.test.ts" },
  { project: "server", path: "test/server.test.ts" },
  { project: "web", path: "test/web.test.ts" },
];
const E2E: TestFileRef = { project: "e2e", path: "e2e/app.e2e.test.ts" };

async function open(exclude: () => readonly string[]) {
  const notes: string[] = [];
  const fx = await openFixture("five-projects", {}, (root) =>
    createVitestAdapter({ root, note: (text) => notes.push(text), exclude }),
  );
  return { fx, notes };
}

const sorted = (refs: readonly TestFileRef[]) =>
  [...refs].sort((a, b) => a.project.localeCompare(b.project));

describe("vitest.exclude (004 D7, task 004-81)", () => {
  it(
    "lists no file an exclude glob selects, and counts each as omitted (review wave-12 B2)",
    SLOW,
    async () => {
      const { fx, notes } = await open(() => ["e2e/**", "test/web.test.ts"]);
      expect(sorted(await fx.adapter.testFiles())).toEqual(FOUR.filter((r) => r.project !== "web"));
      // A bare `vitest run` still runs them, so the hook must not answer it (005 D8 step 3).
      expect(fx.adapter.omittedTestFiles?.()).toBe(2);
      const shared = await fx.adapter.affected(["src/shared.ts"]);
      expect(sorted([...shared.direct, ...shared.transitive])).toEqual(
        FOUR.filter((r) => r.project !== "web"),
      );
      // A file only the excluded suite reads affects nothing.
      const browser = await fx.adapter.affected(["src/browser-only.ts"]);
      expect([...browser.direct, ...browser.transitive]).toEqual([]);
      expect(notes).toEqual([]);
    },
  );

  it("takes an edit of the key mid-session, so the next listing has it", SLOW, async () => {
    let excluded: readonly string[] = [];
    const { fx } = await open(() => excluded);
    expect(sorted(await fx.adapter.testFiles())).toContainEqual(E2E);

    excluded = ["e2e/**"];
    const narrowed = await fx.adapter.invalidate([{ path: "squeal.config.json", kind: "change" }]);
    expect(narrowed.recreatedProjects.length).toBeGreaterThan(0);
    expect(sorted(await fx.adapter.testFiles())).toEqual(FOUR);

    excluded = [];
    await fx.adapter.invalidate([{ path: "squeal.config.json", kind: "change" }]);
    expect(sorted(await fx.adapter.testFiles())).toContainEqual(E2E);
  });
});
