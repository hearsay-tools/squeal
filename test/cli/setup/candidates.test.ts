import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { holdsArtifact } from "../../../src/cli/setup/artifacts.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
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
  it("finds test/e2e exactly, with dist and plugins as sibling candidates, never ranked", async () => {
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
                {
                  rule: "named",
                  detail:
                    'gitignored, named by 2 of 2 test files, such as "plugins/codex/dist/cli/squeal.mjs"',
                  weak: false,
                },
              ],
            },
            {
              path: "plugins",
              exists: true,
              ignored: false,
              evidence: [{ rule: "files", detail: './package.json files "plugins"', weak: true }],
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
