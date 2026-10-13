import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { holdsArtifact } from "../../../src/cli/setup/artifacts.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { answerPlan, NO_ANSWERS, type Question } from "../../../src/cli/setup/questions.js";
import {
  capture,
  cezarionShaped,
  cleanupFixtures,
  harnessEnv,
  json,
  squealShaped,
} from "./fixture.js";

/*
 * Spec 005 D3, "Slow tests and their inputs", row 005-12: the candidates
 * match `research/wave-0-checks.md` 7's table on fixtures of its two
 * repositories.
 */

afterEach(cleanupFixtures);

const plan = (root: string) => buildPlan(root, { env: harnessEnv() });

describe("this repository's shape", () => {
  it("finds test/e2e exactly, with dist and plugins as sibling candidates; only plugins is named", async () => {
    const root = squealShaped();
    const { slow } = await plan(root);
    expect(slow).toEqual({
      unresolvedScripts: [],
      groups: [
        {
          dir: "test/e2e",
          files: ["test/e2e/plugin-copy.test.ts", "test/e2e/shipped-plugin.test.ts"],
          reasons: ["under a directory named e2e"],
          defaultSlow: true,
          declaredSlow: false,
          declaredInputs: ["plugins/claude-code/**", "plugins/codex/**"],
          artifacts: [
            {
              path: "dist",
              exists: false,
              ignored: true,
              evidence: [
                { rule: "bin", detail: './package.json bin "dist/cli/index.js"', weak: false },
                { rule: "files", detail: './package.json files "dist"', weak: true },
                {
                  rule: "build-script",
                  detail: "build script .:build (tsc -p tsconfig.build.json) writes dist",
                  weak: false,
                },
              ],
            },
            {
              path: "plugins",
              exists: true,
              ignored: false,
              evidence: [
                { rule: "files", detail: './package.json files "plugins"', weak: true },
                {
                  rule: "named",
                  detail: 'named by 1 of 2 test files, such as "plugins/codex/dist/cli/squeal.mjs"',
                  weak: false,
                },
              ],
            },
          ],
          broader: null,
          inputsHoldArtifact: true,
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

  it("says a gitignored candidate is not built, and that the config lacks the slow key", async () => {
    const root = squealShaped();
    const { io, out } = capture(root);
    expect(await main(["setup", "--check"], io)).toBe(1);
    expect(out.stdout).toContain("    artifact? dist, not built in this worktree\n");
    expect(out.stdout).toContain('      ./package.json files "plugins" (weak)\n');
    expect(out.stdout).toContain('Outdated:\n  squeal.config.json has no "slow" key\n');
  });

  it("--check names a declared slow group whose inputs hold no artifact", async () => {
    const root = squealShaped({
      "squeal.config.json": json({
        slow: { include: ["test/e2e/**/*.test.ts"] },
        inputs: { "test/e2e/*.test.ts": ["test/fixtures/e2e/**"] },
      }),
    });
    const facts = await plan(root);
    expect(facts.slow.groups[0]).toMatchObject({ declaredSlow: true, inputsHoldArtifact: false });
    expect(facts.outdated).toEqual([
      "test/e2e: declared slow, but no declared input holds an artifact it may test (dist, plugins)",
    ]);
    writeFileSync(
      join(root, "squeal.config.json"),
      json({
        slow: { include: ["test/e2e/**/*.test.ts"] },
        inputs: { "test/e2e/*.test.ts": ["plugins/**"] },
      }),
    );
    const { io } = capture(root);
    expect(await main(["setup", "--check"], io)).toBe(0);
  });
});

describe("cezarion's shape", () => {
  it("finds the e2e group, a test/unit group not slow by default, and the three artifact candidates", async () => {
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
    expect(
      e2e?.artifacts.map((a) => [a.path, a.exists, a.ignored, a.evidence.map((e) => e.rule)]),
    ).toEqual([
      ["packages/cezar/dist", true, true, ["bin", "exports", "files", "build-script", "named"]],
      ["packages/cezar/scripts", true, false, ["files"]],
      ["packages/cezar/web/dist", false, true, ["files", "named"]],
    ]);
    expect(e2e?.broader).toBeNull();
  });

  it("counts a string as naming a candidate only as a path under it, never web/dist for dist", async () => {
    const [e2e] = (await plan(cezarionShaped())).slow.groups;
    const named = (path: string) =>
      e2e?.artifacts.find((a) => a.path === path)?.evidence.find((e) => e.rule === "named")?.detail;
    expect(named("packages/cezar/dist")).toBe(
      'gitignored, named by 1 of 2 test files, such as "../../dist/application-update/service.js"',
    );
    expect(named("packages/cezar/web/dist")).toBe(
      'gitignored, named by 1 of 2 test files, such as "web/dist/index.html"',
    );
    expect(named("packages/cezar/scripts")).toBeUndefined();
  });
});

/** The input question each slow group asks with every default taken, and the inputs it answers. */
async function inputQuestions(root: string) {
  const asked: Question[] = [];
  const answers = await answerPlan(await plan(root), NO_ANSWERS, async (q) => {
    if (q.text.includes("may test these artifacts")) asked.push(q);
    return 0;
  });
  return { choices: asked.map((q) => q.choices), inputs: answers.inputs };
}

describe("the input question's default (005-38)", () => {
  it("this repository's shape without declared inputs: plugins/**, not root dist", async () => {
    const { choices, inputs } = await inputQuestions(
      squealShaped({ "squeal.config.json": json({}) }),
    );
    expect(choices).toEqual([["plugins/**", "dist/**", "dist/** and plugins/**", "none"]]);
    expect(inputs).toEqual([{ test: "test/e2e/**", input: "plugins/**" }]);
  });

  it("cezarion's shape: packages/cezar/dist/**, never the scripts source directory", async () => {
    const { choices, inputs } = await inputQuestions(cezarionShaped());
    expect(choices).toEqual([
      [
        "packages/cezar/dist/**",
        "packages/cezar/scripts/**",
        "packages/cezar/web/dist/**",
        "packages/cezar/dist/** and packages/cezar/scripts/** and packages/cezar/web/dist/**",
        "none",
      ],
    ]);
    expect(inputs).toEqual([
      { test: "packages/cezar/test/e2e/**", input: "packages/cezar/dist/**" },
    ]);
  });

  it("takes every candidate tied on all three ranks", async () => {
    // Both built, both written by the build script, both named: nothing tells them apart.
    const root = cezarionShaped({
      "packages/cezar/package.json": json({
        name: "@wjarka/cezar",
        bin: { cezar: "./dist/cli.js" },
        files: ["dist", "web/dist", "scripts"],
        scripts: {
          build: "tsc -p tsconfig.json && vite build --outDir web/dist",
          "test:package": "node --import tsx --test test/e2e/*.test.ts",
        },
      }),
    });
    mkdirSync(join(root, "packages/cezar/web/dist"), { recursive: true });
    const { choices, inputs } = await inputQuestions(root);
    expect(choices[0]?.[0]).toBe("packages/cezar/dist/** and packages/cezar/web/dist/**");
    expect(inputs.map((i) => i.input)).toEqual([
      "packages/cezar/dist/**",
      "packages/cezar/web/dist/**",
    ]);
  });
});

describe("holdsArtifact", () => {
  it("judges an input glob by its directory part", () => {
    expect(holdsArtifact("plugins/claude-code/**", "plugins")).toBe(true);
    expect(holdsArtifact("plugins/**", "plugins/codex/dist")).toBe(true);
    expect(holdsArtifact("dist", "dist")).toBe(true);
    expect(holdsArtifact("./dist/**", "dist")).toBe(true);
    expect(holdsArtifact("**", "dist")).toBe(true);
    expect(holdsArtifact("*.json", "dist")).toBe(false);
    expect(holdsArtifact("distribution/**", "dist")).toBe(false);
    expect(holdsArtifact("test/fixtures/e2e/**", "plugins")).toBe(false);
  });
});
