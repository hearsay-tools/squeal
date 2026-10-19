import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { answerPlan, NO_ANSWERS } from "../../../src/cli/setup/questions.js";
import {
  ALL_NAMED_E2E,
  capture,
  cezarionShaped,
  cleanupFixtures,
  harnessEnv,
  json,
  SLOW_ONLY_E2E,
  squealShaped,
} from "./fixture.js";

/*
 * Spec 005 D3, "Slow tests and build-output tests", row 005-12: the
 * candidates match `research/wave-0-checks.md` 7's table on fixtures of its
 * two repositories. Task 004-81 (004 D5 as amended 2026-10-18): no artifact
 * is proposed, asked about or called outdated; row 005-70 proposes the
 * runner's `exclude` instead (`exclude-proposal.test.ts`).
 */

afterEach(cleanupFixtures);

const plan = (root: string) => buildPlan(root, { env: harnessEnv() });

describe("this repository's shape", () => {
  it("finds test/e2e exactly, an exclude candidate and no artifact one", async () => {
    const root = squealShaped();
    const { slow } = await plan(root);
    expect(slow.groups[0]?.buildOutputs?.map((o) => o.path)).toEqual(["plugins/codex/dist"]);
    // Wave 13 B1: shipped-plugin names no build output, so only plugin-copy is excluded.
    expect(slow.groups[0]?.exclude).toEqual({
      globs: ["test/e2e/plugin-copy.test.ts"],
      into: [{ runner: "vitest", glob: "test/e2e/plugin-copy.test.ts" }],
      kept: ["test/e2e/shipped-plugin.test.ts"],
    });
    const { buildOutputs: _, exclude: __, ...group } = slow.groups[0] ?? {};
    expect({ ...slow, groups: [group] }).toEqual({
      unresolvedScripts: [],
      groups: [
        {
          dir: "test/e2e",
          files: ["test/e2e/plugin-copy.test.ts", "test/e2e/shipped-plugin.test.ts"],
          reasons: ["under a directory named e2e"],
          defaultSlow: true,
          declaredSlow: false,
          declaredInputs: ["plugins/claude-code/**", "plugins/codex/**"],
        },
      ],
    });
  });

  it("takes no group from a fixture package's own scripts", async () => {
    const root = squealShaped({
      "test/fixtures/e2e/demo/package.json": json({
        scripts: { "test:package": "node --test test/e2e/*.test.ts" },
      }),
      "test/fixtures/e2e/demo/test/e2e/cli.test.ts": "\n",
    });
    expect((await plan(root)).slow.groups.map((g) => g.dir)).toEqual(["test/e2e"]);
  });

  it("names no artifact, and says the config lacks the slow key or, for an exclude candidate, vitest.exclude", async () => {
    for (const [files, keys] of [
      [SLOW_ONLY_E2E, ["slow"]],
      [ALL_NAMED_E2E, ["vitest.exclude"]],
      // Wave 13 B1: a partial exclude leaves slow candidates too.
      [{}, ["slow", "vitest.exclude"]],
    ] as const) {
      const { io, out } = capture(squealShaped(files));
      expect(await main(["setup", "--check"], io)).toBe(1);
      expect(out.stdout).not.toContain("artifact");
      const lines = keys.map((key) => `  squeal.config.json has no "${key}" key\n`).join("");
      expect(out.stdout).toContain(`Outdated:\n${lines}`);
    }
  });

  it("--check calls a declared slow group with no artifact input nothing outdated", async () => {
    const root = squealShaped({
      "squeal.config.json": json({
        slow: { include: ["test/e2e/**/*.test.ts"] },
        inputs: { "test/e2e/*.test.ts": ["test/fixtures/e2e/**"] },
      }),
    });
    const facts = await plan(root);
    expect(facts.slow.groups[0]).toMatchObject({ declaredSlow: true });
    expect(facts.outdated).toEqual([]);
    const { io } = capture(root);
    expect(await main(["setup", "--check"], io)).toBe(0);
  });
});

describe("cezarion's shape", () => {
  it("finds the e2e group and a test/unit group not slow by default", async () => {
    const root = cezarionShaped();
    const { slow } = await plan(root);
    expect(slow.unresolvedScripts).toEqual([".:test:e2e = sh .ai/scripts/e2e.sh"]);
    expect(slow.groups.map((g) => [g.dir, g.files.length, g.defaultSlow])).toEqual([
      ["packages/cezar/test/e2e", 2, true],
      ["packages/cezar/test/unit", 1, false],
    ]);
    const [e2e, unit] = slow.groups;
    expect(e2e?.reasons).toEqual([
      "under a directory named e2e",
      "run by npm script .:test:package",
      "run by npm script packages/cezar:test:package",
      "node:test project test:package",
    ]);
    expect(unit?.reasons).toEqual(["node:test project test:unit"]);
  });
});

describe("the setup wizard asks no input question (004-81)", () => {
  it.each([
    ["this repository's shape", squealShaped],
    ["cezarion's shape", cezarionShaped],
  ])("%s: every default taken, it asks only whether each group is slow", async (_, shaped) => {
    const texts: string[] = [];
    const answers = await answerPlan(await plan(shaped()), NO_ANSWERS, async (q) => {
      texts.push(q.text);
      return 0;
    });
    expect(texts.some((text) => text.includes("artifact"))).toBe(false);
    expect(answers.inputs).toEqual([]);
  });
});
