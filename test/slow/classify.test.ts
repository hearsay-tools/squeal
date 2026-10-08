import { describe, expect, it } from "vitest";
import { slowFiles } from "../../src/core/slow/classify.js";
import { DEFAULT_POLICY, type NodeTestProject, type Policy } from "../../src/core/types/index.js";

/*
 * Spec 004 D1: a file matched by `slow.include` is slow whatever its runner;
 * a `nodeTest` entry with `slow: true` marks every file its `include` lists.
 */

const PACKAGE: NodeTestProject = {
  name: "test:package",
  argv: [],
  env: {},
  include: ["test/e2e/*.test.ts"],
  slow: true,
};
const UNIT: NodeTestProject = { name: "test:unit", argv: [], env: {}, include: ["test/*.test.ts"] };

function policy(include: readonly string[], nodeTest: readonly NodeTestProject[] = []): Policy {
  return { ...DEFAULT_POLICY, slow: { ...DEFAULT_POLICY.slow, include }, nodeTest };
}

describe("slowFiles (spec 004 D1)", () => {
  it("marks a file matching a slow.include glob in any project", () => {
    const isSlow = slowFiles(policy(["test/e2e/**/*.test.ts", "packages/*/e2e.test.ts"]), []);
    expect(isSlow({ project: "default", path: "test/e2e/install/plugin.test.ts" })).toBe(true);
    expect(isSlow({ project: "web", path: "packages/web/e2e.test.ts" })).toBe(true);
    expect(isSlow({ project: "test:unit", path: "test/e2e/cli.test.ts" })).toBe(true);
  });

  it("marks every file of a nodeTest project with slow: true", () => {
    const given = policy([], [PACKAGE, UNIT]);
    const isSlow = slowFiles(given, given.nodeTest);
    expect(isSlow({ project: "test:package", path: "packages/cli/test/e2e/a.test.ts" })).toBe(true);
    expect(isSlow({ project: "test:unit", path: "test/a.test.ts" })).toBe(false);
  });

  it("follows the projects it is given, not the policy's", () => {
    const isSlow = slowFiles(policy([], [PACKAGE]), [{ ...PACKAGE, slow: false }]);
    expect(isSlow({ project: "test:package", path: "test/e2e/a.test.ts" })).toBe(false);
  });

  it("is false for a file matching neither", () => {
    const given = policy(["test/e2e/**/*.test.ts"], [PACKAGE, UNIT]);
    const isSlow = slowFiles(given, given.nodeTest);
    expect(isSlow({ project: "default", path: "test/unit/e2e.test.ts" })).toBe(false);
    expect(isSlow({ project: "test:unit", path: "test/e2e.test.ts" })).toBe(false);
  });

  it("is false for every file under the defaults", () => {
    const isSlow = slowFiles(DEFAULT_POLICY, DEFAULT_POLICY.nodeTest);
    expect(isSlow({ project: "default", path: "test/e2e/a.test.ts" })).toBe(false);
  });
});
