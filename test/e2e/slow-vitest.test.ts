import { describe, it } from "vitest";
import { e2eSuite, OTHER_SESSION, PLUGINS, STRINGS } from "./harness.js";
import {
  CLI,
  fastFirstThenSlow,
  inheritsOnlyWithTheArtifactEqual,
  type Shape,
  SLOW_TUNING,
} from "./slow-shape.js";

/*
 * Spec 004 Testing, end to end, on this repository's shape: a Vitest e2e
 * directory over a small built `dist`, declared slow by `slow.include` and
 * keyed by `dist/**` (D1, D5). The fixture adds `test/e2e/cli.test.ts`,
 * which spawns `dist/cli.mjs`, to `test/fixtures/e2e/project`.
 */

const fixture = e2eSuite();

const E2E_FILE = "test/e2e/cli.test.ts";

const SHAPE: Shape = {
  options: {
    overlay: "slow-vitest",
    files: { "dist/cli.mjs": CLI() },
    policy: {
      slow: { include: ["test/e2e/**/*.test.ts"], ...SLOW_TUNING },
      inputs: { "test/e2e/**/*.test.ts": ["dist/**"] },
    },
  },
  artifact: "dist/cli.mjs",
  declared: "dist/**",
  slowFiles: [E2E_FILE],
  /** `math > adds`, `math > multiplies`, `shouts`, the CLI's check, and each of the 3 files' file-level check. */
  checks: 4 + 3,
  fast: {
    source: "strings",
    broken: STRINGS("?"),
    testFile: "test/strings.test.ts",
    check: "shouts",
  },
};

describe.each(PLUGINS)("slow Vitest e2e end to end, $name", (plugin) => {
  it("reports the fast tests first, runs the slow file on idle and on run --slow", async (ctx) => {
    await fastFirstThenSlow(fixture(ctx, plugin, SHAPE.options), SHAPE);
  }, 400_000);

  it("is inherited by a second worktree only with the artifact equal", async (ctx) => {
    const e = fixture(ctx, plugin, SHAPE.options);
    await inheritsOnlyWithTheArtifactEqual(e, SHAPE, [OTHER_SESSION, THIRD_SESSION]);
  }, 400_000);
});

const THIRD_SESSION = "5a1f3c9e-7b2d-4e8a-9c6f-1d3b5e7a9f20";
