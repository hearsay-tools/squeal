import { describe, expect, it } from "vitest";
import { groupView, laneFor, slowView } from "../../src/core/scheduler/slow.js";
import { slowFiles, slowGlobs } from "../../src/core/slow/classify.js";
import { groupTierMetaKey, slowTierMetaKey } from "../../src/core/slow/state.js";
import {
  type CheckGroup,
  DEFAULT_POLICY,
  groupLane,
  isGroupLane,
  isSlowLane,
  laneGroup,
  type Policy,
  type PytestProject,
} from "../../src/core/types/index.js";
import { nodeTestEntries, nodeTestGroup, slowNodeTestPolicy } from "./group-lanes-fixture.js";

/*
 * Spec 019 D1 to D3, wave 2's lane contract (row 019-10 slice 1): a file's
 * lane is its group's. The default `tests` group keeps the runner's lane,
 * the default `slow` group `slow:<runner lane>`, a configured group
 * `group:<name>:<runner lane>`. `pytest[].slow` marks its entry's files
 * slow (004 D1, 007 D1), which it did not before.
 */

const PY: PytestProject = {
  name: "api",
  cwd: "py",
  args: [],
  env: {},
  include: ["tests/test_*.py"],
  slow: true,
};

function policy(given: Partial<Policy> = {}): Policy {
  return {
    ...DEFAULT_POLICY,
    ...slowNodeTestPolicy(),
    pytest: [PY, { ...PY, name: "web", slow: false }],
    slow: { ...DEFAULT_POLICY.slow, include: ["test/e2e/**"] },
    ...given,
  };
}

const E2E: CheckGroup = {
  name: "e2e",
  runner: "vitest",
  tests: ["test/e2e/**"],
  at: "stop",
};
const UNIT: CheckGroup = { name: "unit", runner: "vitest", at: "edit" };

describe("group lanes (spec 019 D3, row 019-10)", () => {
  it("names each group's lane by the contract", () => {
    expect(groupLane("tests", "vitest")).toBe("vitest");
    expect(groupLane("slow", "vitest")).toBe("slow:vitest");
    expect(groupLane("e2e", "vitest")).toBe("group:e2e:vitest");
    expect(groupLane("e2e", "")).toBe("group:e2e:");
    expect(["vitest", "slow:vitest", "group:e2e:vitest"].map(isGroupLane)).toEqual([
      false,
      true,
      true,
    ]);
    // `isSlowLane` keeps its meaning for `"slow:"` only.
    expect(isSlowLane("group:e2e:vitest")).toBe(false);
    expect(["vitest", "slow:node-test", "group:e2e:vitest", "group:e2e:"].map(laneGroup)).toEqual([
      "tests",
      "slow",
      "e2e",
      "e2e",
    ]);
  });

  it("keys a group's activity row by the contract", () => {
    expect(groupTierMetaKey("slow", "w1")).toBe(slowTierMetaKey("w1"));
    expect(slowTierMetaKey("w1")).toBe("slow-tier:w1");
    expect(groupTierMetaKey("e2e", "w1")).toBe("group-tier:e2e:w1");
  });

  it("gives today's lanes with no `checks` key, and slow pytest files the slow lane", () => {
    const given = policy();
    const lane = (project: string, path: string, runner: string) =>
      laneFor(given, { project, path }, runner);
    expect(lane("", "test/a.test.ts", "vitest")).toBe("vitest");
    expect(lane("", "test/e2e/b.test.ts", "vitest")).toBe("slow:vitest");
    expect(lane("nt", "nt/c.test.mjs", "node-test")).toBe("slow:node-test");
    expect(lane("api", "py/tests/test_d.py", "pytest")).toBe("slow:pytest");
    expect(lane("web", "py/tests/test_e.py", "pytest")).toBe("pytest");
  });

  it("puts a configured group's files in its own lane, the first group that selects one owning it", () => {
    const given = policy({ checks: [E2E, UNIT] });
    const lane = (path: string) => laneFor(given, { project: "", path }, "vitest");
    expect(lane("test/e2e/b.test.ts")).toBe("group:e2e:vitest");
    expect(lane("test/a.test.ts")).toBe("group:unit:vitest");
    // The node:test and pytest files no group selects stay in the default groups.
    expect(laneFor(given, { project: "nt", path: "nt/c.test.mjs" }, "node-test")).toBe(
      "slow:node-test",
    );
    expect(laneFor(given, { project: "web", path: "py/tests/test_e.py" }, "pytest")).toBe("pytest");
    expect(groupView(given).of({ project: "", path: "test/a.test.ts" }).name).toBe("unit");
    // Every group but `tests` is the slow class.
    expect(slowView(given).isSlow({ project: "", path: "test/a.test.ts" })).toBe(true);
    expect(slowView(given).isSlow({ project: "web", path: "py/tests/test_e.py" })).toBe(false);
  });

  it("selects a group's runner by the project's `squeal.config.json` key", () => {
    const api: CheckGroup = { name: "api", runner: "pytest", project: "api", at: "pause" };
    const nt = nodeTestGroup("nodes", "edit");
    const given = policy({ checks: [api, nt] });
    expect(laneFor(given, { project: "api", path: "py/tests/test_d.py" }, "pytest")).toBe(
      "group:api:pytest",
    );
    expect(laneFor(given, { project: "nt", path: "nt/c.test.mjs" }, "node-test")).toBe(
      "group:nodes:node-test",
    );
    // A Vitest file is no node:test group's, even under the same path.
    expect(laneFor(given, { project: "", path: "nt/c.test.mjs" }, "vitest")).toBe("vitest");
  });
});

describe("pytest[].slow (spec 004 D1, 007 D1; row 019-10)", () => {
  it("marks every file of a pytest entry with `slow: true` in slowFiles and slowGlobs", () => {
    const given = policy({ slow: { ...DEFAULT_POLICY.slow, include: [] } });
    const isSlow = slowFiles(given, nodeTestEntries(given));
    expect(isSlow({ project: "api", path: "py/tests/test_d.py" })).toBe(true);
    expect(isSlow({ project: "web", path: "py/tests/test_e.py" })).toBe(false);
    expect(slowGlobs(given, nodeTestEntries(given))).toEqual([
      "nt/*.test.mjs",
      "py/tests/test_*.py",
    ]);
    expect(slowView(given).declared).toBe(true);
  });
});
