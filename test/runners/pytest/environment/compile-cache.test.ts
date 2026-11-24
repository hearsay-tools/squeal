import { describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import type { PytestProject } from "../../../../src/core/types/policy.js";
import { runEnvironment } from "../../../../src/runners/pytest/environment/hash.js";

/*
 * Spec 025 D7.2: pytest's processes, and any Node a test starts, get no
 * NODE_COMPILE_CACHE from Squeal's launchers; a user's or the project's own
 * reaches them.
 */

const ENV = "/venv" as AbsolutePath;
const project = (env: Record<string, string> = {}): PytestProject => ({
  name: "p",
  args: [],
  env,
  include: ["tests/**/test_*.py"],
});
const OWN = { PATH: "/bin", NODE_COMPILE_CACHE: "/c/squeal", SQUEAL_OWN_COMPILE_CACHE: "1" };

describe("pytest's run environment and the compile cache (spec 025 D7.2)", () => {
  it("leaves out Squeal's own", () => {
    const run = runEnvironment(ENV, project(), OWN);
    expect(run.NODE_COMPILE_CACHE).toBeUndefined();
    expect(run.SQUEAL_OWN_COMPILE_CACHE).toBeUndefined();
    expect(run.PATH).toBe("/venv/bin:/bin");
  });

  it("keeps a user's, and the project's own over Squeal's", () => {
    expect(
      runEnvironment(ENV, project(), { PATH: "/bin", NODE_COMPILE_CACHE: "/mine" }),
    ).toMatchObject({
      NODE_COMPILE_CACHE: "/mine",
    });
    const run = runEnvironment(ENV, project({ NODE_COMPILE_CACHE: "/project" }), OWN);
    expect(run.NODE_COMPILE_CACHE).toBe("/project");
    expect(run.SQUEAL_OWN_COMPILE_CACHE).toBeUndefined();
  });
});
