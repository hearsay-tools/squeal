import { describe, expect, it } from "vitest";
import { jestProjects } from "../../src/core/daemon/policy-jest.js";

/** The kept entries, or a failure naming what was expected. */
function kept(value: unknown) {
  const result = jestProjects(value, "jest");
  if (typeof result === "string") throw new Error(`expected entries, got: ${result}`);
  return result;
}

describe("jestProjects (spec 028 D1)", () => {
  it("is what was expected when the list is not a list", () => {
    expect(jestProjects({ name: "web" }, "jest")).toBe("an array of projects");
  });

  it("keeps a minimal entry with the defaults applied", () => {
    expect(kept([{ name: "web", config: "packages/web/jest.config.ts" }])).toEqual({
      kept: [
        {
          name: "web",
          config: "packages/web/jest.config.ts",
          include: [],
          exclude: [],
          args: [],
          env: {},
        },
      ],
      problems: [],
    });
  });

  it("keeps every key as given", () => {
    const entry = {
      name: "web",
      config: "packages/web/package.json",
      cwd: "packages/web",
      include: ["src/**/*.test.ts"],
      exclude: ["src/legacy/**"],
      args: ["--ci"],
      env: { TZ: "UTC" },
      slow: true,
      batchSize: 3,
      container: "node22",
    };
    expect(kept([entry])).toEqual({ kept: [entry], problems: [] });
  });

  it("accepts each config extension Jest reads", () => {
    const configs = [
      "a.js",
      "b.ts",
      "c.mjs",
      "d.cjs",
      "e.mts",
      "f.cts",
      "g.json",
      "jest.unit.config.js",
    ];
    const entries = configs.map((config, i) => ({ name: `p${i}`, config }));
    expect(kept(entries).problems).toEqual([]);
  });

  it("skips an entry without a name or a config, and keeps the others", () => {
    const result = kept([
      { config: "jest.config.js" },
      { name: "web" },
      { name: "api", config: "api/jest.config.js" },
    ]);
    expect(result.kept.map((p) => p.name)).toEqual(["api"]);
    expect(result.problems).toEqual([
      '"jest[0].name" must be a non-empty string, got undefined; it is skipped',
      '"jest[1].config" must be a non-empty string, got undefined; project "web" is skipped',
    ]);
  });

  it("skips a config or cwd outside the worktree", () => {
    const result = kept([
      { name: "up", config: "../other/jest.config.js" },
      { name: "abs", config: "/repo/jest.config.js" },
      { name: "cwd", config: "jest.config.js", cwd: "../x" },
    ]);
    expect(result.kept).toEqual([]);
    expect(result.problems).toEqual([
      '"jest[0].config" must be a path inside the worktree, relative to its root, got "../other/jest.config.js"; project "up" is skipped',
      '"jest[1].config" must be a path inside the worktree, relative to its root, got "/repo/jest.config.js"; project "abs" is skipped',
      '"jest[2].cwd" must be a path inside the worktree, relative to its root, got "../x"; project "cwd" is skipped',
    ]);
  });

  it("skips a config that names no file Jest reads as a config", () => {
    const result = kept([
      { name: "dir", config: "packages/web" },
      { name: "yaml", config: "jest.config.yaml" },
    ]);
    expect(result.kept).toEqual([]);
    expect(result.problems).toEqual([
      '"jest[0].config" must name a Jest config file (.js, .ts, .mjs, .cjs, .mts, .cts, .json) or a package.json, got "packages/web"; project "dir" is skipped',
      '"jest[1].config" must name a Jest config file (.js, .ts, .mjs, .cjs, .mts, .cts, .json) or a package.json, got "jest.config.yaml"; project "yaml" is skipped',
    ]);
  });

  it("skips an unknown key, a bad batchSize, an empty include and a repeated name", () => {
    const result = kept([
      { name: "a", config: "jest.config.js", testMatch: ["x"] },
      { name: "b", config: "jest.config.js", batchSize: 0 },
      { name: "c", config: "jest.config.js", include: [] },
      { name: "d", config: "jest.config.js", container: "" },
      { name: "e", config: "jest.config.js" },
      { name: "e", config: "other/jest.config.js" },
    ]);
    expect(result.kept.map((p) => p.config)).toEqual(["jest.config.js"]);
    expect(result.problems).toEqual([
      'unknown key "jest[0].testMatch"; project "a" is skipped',
      '"jest[1].batchSize" must be a positive integer, got 0; project "b" is skipped',
      '"jest[2].include" must be a non-empty array of strings, got []; project "c" is skipped',
      '"jest[3].container" must be a non-empty string, got ""; project "d" is skipped',
      '"jest[5].name" repeats "e" of an earlier project; it is skipped',
    ]);
  });
});
