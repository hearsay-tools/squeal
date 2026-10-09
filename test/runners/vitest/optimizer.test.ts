import { describe, expect, it } from "vitest";
import { optimizerOffNote } from "../../../src/core/state/optimizer-note.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { loadVitest } from "../../../src/runners/vitest/load.js";
import { optimizerInUse, withoutOptimizer } from "../../../src/runners/vitest/optimizer.js";
import { INLINE, SEPARATE } from "../../integration/optimizer-repo.js";
import { BASE, createRepo, NEW } from "../../integration/stamps-repo.js";
import { OPTIMIZED } from "../../integration/touched-repo.js";

/*
 * Task 001-176: Vitest's dependency optimizer is off in every project
 * Squeal starts, as Vitest resolved it, wherever the config turned it on.
 */

const SLOW = { timeout: 120_000 } as const;

const CASES = [
  ["the root config", OPTIMIZED, ""],
  ["a project's own config file", SEPARATE, "p"],
  ["an inline project with a server of its own", INLINE, "i"],
] as const;

describe("the dependency optimizer (001-176)", () => {
  it.each(CASES)("is off as Vitest resolved %s", SLOW, async (_, files, project) => {
    const repo = createRepo({ ...files, "src/mod.js": NEW });
    const node = await loadVitest(repo.main);
    // As `VitestAdapter.#start` makes it.
    const vitest = await node.createVitest("test", {
      root: repo.main,
      watch: false,
      reporters: [],
      update: "none",
      fsModuleCache: false,
    });
    try {
      const names = vitest.projects.map((p) => p.name);
      expect(names).toContain(project);
      expect(optimizerInUse(vitest)).toEqual(
        expect.arrayContaining([`${project}:ssr:enabled`, `${project}:ssr:local-pkg`]),
      );

      expect(withoutOptimizer(vitest)).toEqual([project]);

      expect(optimizerInUse(vitest)).toEqual([]);
      const options = vitest.projects.find((p) => p.name === project)?.config.deps.optimizer;
      expect(options?.ssr?.enabled).toBe(false);
      expect(options?.client?.enabled).toBe(false);
    } finally {
      await vitest.close();
    }
  });

  it.each(CASES)(
    "is noted once for %s, however many instances start",
    SLOW,
    async (_, files, project) => {
      const repo = createRepo({ ...files, "src/mod.js": NEW });
      const notes: string[] = [];
      const ref = { project, path: "test/optimized.test.ts" };
      for (let i = 0; i < 2; i++) {
        const adapter = await createVitestAdapter({ root: repo.main, note: (t) => notes.push(t) });
        try {
          const report = await adapter.run([ref], {
            runId: `run-${i}`,
            logDir: `${repo.main}/.squeal-logs`,
            timeoutMs: null,
          });
          expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
        } finally {
          await adapter.close();
        }
      }
      expect(notes).toEqual([optimizerOffNote([project])]);
    },
  );

  it("notes nothing for a config that leaves it off", SLOW, async () => {
    const repo = createRepo(BASE);
    const notes: string[] = [];
    const adapter = await createVitestAdapter({ root: repo.main, note: (t) => notes.push(t) });
    await adapter.close();
    expect(notes).toEqual([]);
  });
});
