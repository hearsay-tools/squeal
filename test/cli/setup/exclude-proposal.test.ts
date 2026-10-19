import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { cezarionShaped, cleanupFixtures, harnessEnv, json, squealShaped } from "./fixture.js";

/*
 * Spec 005 D3 "Slow tests and build-output tests" (row 005-70), steps 1 and
 * 2: a group whose test files name a build output is an exclude candidate,
 * proposed for its runner's `exclude` with that evidence, never as a slow glob.
 */

afterEach(cleanupFixtures);

const plan = (root: string) => buildPlan(root, { env: harnessEnv() });

/** This repository's shape, its e2e tests spawning only the gitignored root `dist`. */
function spawnsDist(): string {
  const root = squealShaped({
    "squeal.config.json": json({}),
    "test/e2e/plugin-copy.test.ts": `spawn("node", ["../../dist/cli/squeal.mjs"]);\n`,
    "test/e2e/shipped-plugin.test.ts": `spawn("node", ["../../dist/cli/squeal.mjs", "--version"]);\n`,
  });
  mkdirSync(join(root, "dist/cli"), { recursive: true });
  writeFileSync(join(root, "dist/cli/squeal.mjs"), "\n");
  return root;
}

describe("the plan's exclude candidates", () => {
  it("proposes vitest.exclude for a test/e2e that spawns a gitignored dist file", async () => {
    const [group] = (await plan(spawnsDist())).slow.groups;
    expect(group?.exclude).toEqual({
      globs: ["test/e2e/**"],
      into: [{ runner: "vitest", glob: "test/e2e/**" }],
      kept: [],
    });
    expect(
      group?.buildOutputs?.map((o) => [o.path, o.ignored, o.evidence.map((e) => e.rule)]),
    ).toEqual([["dist", true, ["bin", "files", "build-script", "named"]]]);
    expect(group?.buildOutputs?.[0]?.evidence.at(-1)?.detail).toBe(
      'gitignored, named by 2 of 2 test files, such as "../../dist/cli/squeal.mjs"',
    );
  });

  it("finds a committed bundle a gitignore rule names, as this repository's plugins/*/dist", async () => {
    const [group] = (await plan(squealShaped())).slow.groups;
    // Wave 13 B1: shipped-plugin names none of it, so plugin-copy alone, by path.
    expect(group?.exclude?.globs).toEqual(["test/e2e/plugin-copy.test.ts"]);
    expect(group?.buildOutputs?.map((o) => o.path)).toEqual(["plugins/codex/dist"]);
  });

  it("proposes nothing for a group that names no build output", async () => {
    const root = squealShaped({
      "test/e2e/plugin-copy.test.ts": `const a = "src/cli/index.ts";\n`,
      "test/e2e/shipped-plugin.test.ts": "\n",
    });
    const [group] = (await plan(root)).slow.groups;
    expect(group?.exclude).toBeNull();
    expect(group?.buildOutputs).toEqual([]);
    expect(group?.defaultSlow).toBe(true);
  });

  it("takes a directory the manifest alone names as no evidence: main can name sources", async () => {
    const root = squealShaped({
      "package.json": json({ name: "x", main: "lib/index.js", devDependencies: { vitest: "^3" } }),
      "lib/index.js": "\n",
      "test/e2e/plugin-copy.test.ts": `import("../../lib/index.js");\n`,
      "test/e2e/shipped-plugin.test.ts": "\n",
    });
    expect((await plan(root)).slow.groups[0]?.exclude).toBeNull();
  });

  it("cezarion's shape: the e2e group goes in vitest.exclude and its node:test project's exclude", async () => {
    const root = cezarionShaped({
      "squeal.config.json": json({
        nodeTest: [
          { name: "test:package", cwd: "packages/cezar", include: ["test/e2e/*.test.ts"] },
        ],
      }),
    });
    const groups = (await plan(root)).slow.groups;
    expect(groups.map((g) => [g.dir, g.exclude?.into ?? null])).toEqual([
      [
        "packages/cezar/test/e2e",
        [
          { runner: "vitest", glob: "packages/cezar/test/e2e/**" },
          { runner: "nodeTest", project: "test:package", glob: "test/e2e/**" },
        ],
      ],
    ]);
    expect(groups[0]?.buildOutputs?.map((o) => o.path)).toEqual([
      "packages/cezar/dist",
      "packages/cezar/web/dist",
    ]);
  });
});
