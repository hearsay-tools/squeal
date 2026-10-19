import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOutputCandidates } from "../../../src/cli/setup/build-outputs.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { readRepoFacts } from "../../../src/cli/setup/repo.js";
import { cezarionShaped, cleanupFixtures, harnessEnv, json, squealShaped } from "./fixture.js";

/*
 * Spec 005 D3 "Slow tests and build-output tests" step 2, the evidence row
 * 005-70's exclude candidates come from: on the fixtures of
 * `research/wave-0-checks.md` 7's two repositories, each slow group's
 * candidates with their evidence, as row 005-12 found them, and since 005-70
 * a tracked directory a gitignore rule names (`plugins/codex/dist`).
 */

afterEach(cleanupFixtures);

/** The candidates of the first slow group setup finds at `root`. */
async function candidates(root: string) {
  const [group] = (await buildPlan(root, { env: harnessEnv() })).slow.groups;
  if (group === undefined) throw new Error("no slow group");
  return buildOutputCandidates(await readRepoFacts(root), group.dir, group.files);
}

describe("build-output candidates", () => {
  it("this repository's shape: dist and plugins as siblings, only plugins and its committed bundle named", async () => {
    expect(await candidates(squealShaped())).toEqual([
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
      {
        path: "plugins/codex/dist",
        exists: true,
        ignored: true,
        evidence: [
          {
            rule: "named",
            detail:
              'gitignored, named by 1 of 2 test files, such as "plugins/codex/dist/cli/squeal.mjs"',
            weak: false,
          },
        ],
      },
    ]);
  });

  it("an explicit relative import of root dist names dist past plugins' suffix (005-42 B2)", async () => {
    const root = squealShaped({
      "squeal.config.json": json({}),
      "test/e2e/plugin-copy.test.ts": `await import("../../dist/cli/squeal.mjs");\nconst bundled = "plugins/codex/dist/cli/squeal.mjs";\n`,
      // The bare string stays ambiguous: it ends plugins' tracked bundle too.
      "test/e2e/shipped-plugin.test.ts": `const bundle = "dist/cli/squeal.mjs";\n`,
    });
    mkdirSync(join(root, "dist/cli"), { recursive: true });
    writeFileSync(join(root, "dist/cli/squeal.mjs"), "\n");
    const found = await candidates(root);
    expect(found.map((a) => [a.path, a.evidence.map((e) => e.rule)])).toEqual([
      ["dist", ["bin", "files", "build-script", "named"]],
      ["plugins", ["files", "named"]],
      ["plugins/codex/dist", ["named"]],
    ]);
    expect(found[0]?.evidence.at(-1)?.detail).toBe(
      'gitignored, named by 1 of 2 test files, such as "../../dist/cli/squeal.mjs"',
    );
  });

  it("cezarion's shape: three candidates, a string naming one only as a path under it", async () => {
    const found = await candidates(cezarionShaped());
    expect(found.map((a) => [a.path, a.exists, a.ignored, a.evidence.map((e) => e.rule)])).toEqual([
      ["packages/cezar/dist", true, true, ["bin", "exports", "files", "build-script", "named"]],
      ["packages/cezar/scripts", true, false, ["files"]],
      ["packages/cezar/web/dist", false, true, ["files", "named"]],
    ]);
    const named = (path: string) =>
      found.find((a) => a.path === path)?.evidence.find((e) => e.rule === "named")?.detail;
    expect(named("packages/cezar/dist")).toBe(
      'gitignored, named by 1 of 2 test files, such as "../../dist/application-update/service.js"',
    );
    expect(named("packages/cezar/web/dist")).toBe(
      'gitignored, named by 1 of 2 test files, such as "web/dist/index.html"',
    );
  });
});
