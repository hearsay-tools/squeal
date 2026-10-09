import { describe, it } from "vitest";
import { DEMO, e2eSuite, OTHER_SESSION, PLUGINS } from "./harness.js";
import {
  CLI,
  fastFirstThenSlow,
  inheritsOnlyWithTheArtifactEqual,
  type Shape,
  SLOW_TUNING,
} from "./slow-shape.js";

/*
 * Spec 004 Testing, end to end, on cezarion's shape: a node:test e2e
 * project over a built package, `slow: true` and keyed by its `dist` (D1,
 * D5). The fixture is the node:test workspace of `node-test.test.ts`, whose
 * `test:package` project gains `packages/demo/test/e2e/cli.test.ts`, which
 * spawns `packages/demo/dist/cli.mjs`; `squeal init` writes the projects and
 * the test marks `test:package` slow, as a user would after it.
 */

const fixture = e2eSuite("node-test");

const PACKAGE = "packages/demo/test/e2e";

const SHAPE: Shape = {
  options: {
    overlay: "slow-node-test",
    files: { "packages/demo/dist/cli.mjs": CLI() },
    amendPolicy: (policy) => ({
      ...policy,
      nodeTest: (policy.nodeTest as { name: string }[]).map((project) =>
        project.name === "test:package" ? { ...project, slow: true } : project,
      ),
      slow: SLOW_TUNING,
      inputs: { [`${PACKAGE}/*.test.ts`]: ["packages/demo/dist/**"] },
    }),
  },
  artifact: "packages/demo/dist/cli.mjs",
  declared: "packages/demo/dist/**",
  slowFiles: [`${PACKAGE}/cli.test.ts`, `${PACKAGE}/package.test.ts`],
  /**
   * node:test `adds`, `sees the preload`, `title > slugs through the
   * workspace package`, `the workspace package resolves by name`, the CLI's
   * check; Vitest `math > adds`, `math > multiplies`, `shouts`; and each of
   * the 6 files' file-level check.
   */
  checks: 8 + 6,
  fast: {
    source: "demo",
    broken: DEMO("-"),
    testFile: "packages/demo/test/unit/math.test.ts",
    check: "adds",
  },
};

describe.each(PLUGINS)("slow node:test e2e end to end, $name", (plugin) => {
  it("reports the fast tests first, runs the slow files on idle and on run --slow", async (ctx) => {
    await fastFirstThenSlow(fixture(ctx, plugin, SHAPE.options), SHAPE);
  }, 400_000);

  it("is inherited by a second worktree only with the artifact equal", async (ctx) => {
    const e = fixture(ctx, plugin, SHAPE.options);
    await inheritsOnlyWithTheArtifactEqual(e, SHAPE, [OTHER_SESSION, THIRD_SESSION]);
  }, 400_000);
});

const THIRD_SESSION = "5a1f3c9e-7b2d-4e8a-9c6f-1d3b5e7a9f20";
