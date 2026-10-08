import { describe, expect, it } from "vitest";
import { inheritsAcrossWorktrees, slowGlobs } from "../../src/core/slow/inherit.js";
import { DEFAULT_POLICY, type NodeTestProject, type Policy } from "../../src/core/types/index.js";

/*
 * Spec 004 D6: a slow result is inherited from another worktree only when
 * its declared inputs match at least one existing file that is neither a
 * test file nor under a directory a slow glob covers; a file that is not
 * slow inherits as before.
 */

const E2E = ["test/e2e/**/*.test.ts"];
const TEST_FILES = new Set(["test/e2e/install.test.ts", "test/unit.test.ts"]);
const slow = (path: string) => ({ path, slow: true });

describe("inheritsAcrossWorktrees (spec 004 D6)", () => {
  it("inherits a file that is not slow, declared inputs or not", () => {
    expect(
      inheritsAcrossWorktrees({ path: "test/unit.test.ts", slow: false }, [], TEST_FILES, E2E),
    ).toBe(true);
  });

  it("never inherits a slow file without declared inputs", () => {
    expect(inheritsAcrossWorktrees(slow("test/e2e/install.test.ts"), [], TEST_FILES, E2E)).toBe(
      false,
    );
  });

  it("inherits a slow file whose declared inputs hold the artifact it tests", () => {
    const declared = ["plugins/claude-code/dist/index.js", "test/e2e/fixtures/a.json"];
    expect(
      inheritsAcrossWorktrees(slow("test/e2e/install.test.ts"), declared, TEST_FILES, E2E),
    ).toBe(true);
  });

  it("does not count test files or files under a slow glob's directory as an artifact", () => {
    const declared = ["test/e2e/fixtures/a.json", "test/e2e/helpers.ts", "test/unit.test.ts"];
    expect(
      inheritsAcrossWorktrees(slow("test/e2e/install.test.ts"), declared, TEST_FILES, E2E),
    ).toBe(false);
  });

  it("reads a literal slow path as covering that file only", () => {
    const declared = ["test/e2e.test.ts", "test/helpers.ts"];
    const files = new Set(["test/e2e.test.ts"]);
    expect(
      inheritsAcrossWorktrees(slow("test/e2e.test.ts"), declared, files, ["test/e2e.test.ts"]),
    ).toBe(true);
    expect(
      inheritsAcrossWorktrees(slow("test/e2e.test.ts"), ["test/e2e.test.ts"], files, [
        "test/e2e.test.ts",
      ]),
    ).toBe(false);
  });

  it("reads a glob with no literal directory as covering everything", () => {
    expect(
      inheritsAcrossWorktrees(slow("a.e2e.ts"), ["dist/index.js"], new Set(), ["**/*.e2e.ts"]),
    ).toBe(false);
  });
});

describe("slowGlobs (spec 004 D6)", () => {
  it("lists slow.include and the include globs of slow node:test projects under their cwd", () => {
    const pkg: NodeTestProject = {
      name: "test:package",
      cwd: "packages/cezar",
      argv: [],
      env: {},
      include: ["test/e2e/*.test.ts", "./more/*.test.ts"],
      slow: true,
    };
    const unit: NodeTestProject = { name: "unit", argv: [], env: {}, include: ["test/*.test.ts"] };
    const policy: Policy = { ...DEFAULT_POLICY, slow: { ...DEFAULT_POLICY.slow, include: E2E } };
    expect(slowGlobs(policy, [pkg, unit])).toEqual([
      "test/e2e/**/*.test.ts",
      "packages/cezar/test/e2e/*.test.ts",
      "packages/cezar/more/*.test.ts",
    ]);
  });
});
