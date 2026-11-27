import { mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedJest } from "../../../src/cli/jest-seed.js";
import { main } from "../../../src/cli/main.js";
import { formatPlan } from "../../../src/cli/setup/format.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { initRepo } from "../../hash/git-repo.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { capture, cleanupFixtures, harnessEnv, json, scratch } from "./fixture.js";

/*
 * Spec 028 D1.2: `squeal setup` seeds a `jest` entry per Jest project, read
 * with the project's own Jest: a root `projects` list is expanded and not
 * seeded, a catch-all root config above nested ones is skipped with a note,
 * and a declared `jest` key is kept. Real Jest 29.7.0 and 30.5.2.
 */

afterEach(cleanupFixtures);

const ENV = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
const TEST = 'test("adds", () => expect(1 + 1).toBe(2));\n';

/** A git repository of `files`, with the installed Jest `major` linked in unless `null`. */
function repo(major: JestMajor | null, files: Readonly<Record<string, string>>): AbsolutePath {
  const root = scratch("squeal-setup-jest-") as AbsolutePath;
  initRepo(root, { "CLAUDE.md": "# Agents\n", ...files });
  if (major !== null) {
    mkdirSync(join(root, "node_modules"), { recursive: true });
    const installed = realpathSync(join(installJest(major), "node_modules/jest"));
    symlinkSync(installed, join(root, "node_modules/jest"));
  }
  return root;
}

const tracked = (files: Readonly<Record<string, string>>) => ["CLAUDE.md", ...Object.keys(files)];

/** A root config listing `packages/*` (one by `displayName`, one by `package.json`) and an Nx-style async list. */
const MONOREPO: Readonly<Record<string, string>> = {
  "package.json": json({ name: "mono", private: true }),
  "jest.config.js":
    'const { getJestProjectsAsync } = require("./tools/jest-projects");\nmodule.exports = async () => ({ projects: await getJestProjectsAsync() });\n',
  "tools/jest-projects.js":
    'exports.getJestProjectsAsync = async () => ["<rootDir>/packages/*"];\n',
  "packages/a/jest.config.js":
    'module.exports = { displayName: "alpha", testEnvironment: "node" };\n',
  "packages/a/test/a.test.js": TEST,
  "packages/b/package.json": json({ name: "b", jest: { testEnvironment: "node" } }),
  "packages/b/test/b.test.js": TEST,
  "packages/c/jest.config.js":
    'module.exports = { displayName: { name: "alpha", color: "blue" }, testEnvironment: "node" };\n',
  "packages/c/test/c.test.js": TEST,
};

/** `saas-boilerplate`'s shape: an empty root config above per-package configs, and stray files. */
const SAAS: Readonly<Record<string, string>> = {
  "package.json": json({ name: "saas", private: true }),
  "jest.config.mjs": "export default {};\n",
  "packages/webapp/jest.config.mjs":
    'export default { displayName: "webapp", testEnvironment: "node" };\n',
  "packages/webapp/src/app.test.js": TEST,
  "packages/core/jest.config.mjs": "export default { testEnvironment: 'node' };\n",
  "packages/core/src/core.test.js": TEST,
  "scripts/__tests__/helper.js": "module.exports = {};\n",
  "test/fixtures/jest.config.js": "module.exports = {};\n",
};

describe.each(JEST_MAJORS)("seedJest on Jest %i (spec 028 D1.2)", { timeout: 60_000 }, (major) => {
  it("seeds a single root project by its folder, or its displayName", async () => {
    const files = {
      "package.json": json({ name: "app", private: true }),
      "jest.config.js": 'module.exports = { testEnvironment: "node" };\n',
      "test/a.test.js": TEST,
    };
    const root = repo(major, files);
    expect(await seedJest(root, tracked(files), ENV)).toEqual({
      projects: [{ name: "jest", config: "jest.config.js" }],
      notes: ['seeded jest project "jest" from jest.config.js'],
    });
    const named = { ...files, "jest.config.js": 'module.exports = { displayName: "app" };\n' };
    const seed = await seedJest(repo(major, named), tracked(named), ENV);
    expect(seed.projects).toEqual([{ name: "app", config: "jest.config.js" }]);
  });

  it("expands a root projects list, an Nx-style async one, and seeds no wrapper", async () => {
    const root = repo(major, MONOREPO);
    const seed = await seedJest(root, tracked(MONOREPO), ENV);
    expect(seed.projects).toEqual([
      { name: "alpha", config: "packages/a/jest.config.js" },
      { name: "packages/b", config: "packages/b/package.json" },
      { name: "packages/c", config: "packages/c/jest.config.js" },
    ]);
    expect(seed.notes).toContain(
      "Jest config jest.config.js lists 3 projects: Squeal seeds each, not the config itself",
    );
  });

  it("skips an empty root config above nested configs, saas-boilerplate's shape", async () => {
    const root = repo(major, SAAS);
    const seed = await seedJest(root, tracked(SAAS), ENV);
    expect(seed.projects).toEqual([
      { name: "packages/core", config: "packages/core/jest.config.mjs" },
      { name: "webapp", config: "packages/webapp/jest.config.mjs" },
    ]);
    expect(seed.notes).toContain(
      "skipped Jest config jest.config.mjs: it lists no projects and sits above packages/core/jest.config.mjs, packages/webapp/jest.config.mjs, whose tests it would run without their own config; Squeal seeds those instead",
    );
    expect(seed.notes.join("\n")).not.toMatch(/fixtures/);
  });

  it("seeds a package.json jest key, and skips a root config that selects no test file", async () => {
    const files = {
      "package.json": json({ name: "app", jest: { testEnvironment: "node" } }),
      "src/a.test.js": TEST,
    };
    const seed = await seedJest(repo(major, files), tracked(files), ENV);
    expect(seed.projects).toEqual([{ name: "jest", config: "package.json" }]);
    const empty = { "jest.config.js": "module.exports = {};\n", "src/a.js": "exports.a = 1;\n" };
    expect(await seedJest(repo(major, empty), tracked(empty), ENV)).toEqual({
      projects: [],
      notes: ["skipped Jest config jest.config.js: it lists no projects and selects no test file"],
    });
  });
});

/** Review 0.1.646 B2's root config: inline projects only, two named, one unnamed, two of one name. */
const INLINE: Readonly<Record<string, string>> = {
  "package.json": json({ name: "app", private: true }),
  "jest.config.cjs": `const project = (displayName, dir) => ({
  ...(displayName === null ? {} : { displayName }),
  rootDir: ".",
  testEnvironment: "node",
  testMatch: ["<rootDir>/" + dir + "/*.test.cjs"],
});
module.exports = {
  projects: [
    project("unit", "unit"),
    project("integration", "integration"),
    project(null, "plain"),
    project("dup", "d1"),
    project("dup", "d2"),
  ],
};
`,
  "unit/a.test.cjs": TEST,
  "integration/b.test.cjs": TEST,
  "plain/c.test.cjs": TEST,
  "d1/d.test.cjs": TEST,
  "d2/e.test.cjs": TEST,
};

/** A folder glob beside an inline project with options of its own. */
const MIXED: Readonly<Record<string, string>> = {
  "package.json": json({ name: "mono", private: true }),
  "jest.config.js": `module.exports = {
  projects: [
    "<rootDir>/packages/*",
    { displayName: "e2e", testEnvironment: "node", globals: { E2E: true }, testMatch: ["<rootDir>/e2e/*.test.js"] },
  ],
};
`,
  "packages/a/jest.config.js":
    'module.exports = { displayName: "alpha", testEnvironment: "node" };\n',
  "packages/a/test/a.test.js": TEST,
  "e2e/flow.test.js": 'test("e2e", () => expect(E2E).toBe(true));\n',
};

describe.each(JEST_MAJORS)(
  "inline Jest projects on Jest %i (review 0.1.646 B2)",
  { timeout: 60_000 },
  (major) => {
    it("seeds each inline object by its displayName, else by #<index>", async () => {
      const seed = await seedJest(repo(major, INLINE), tracked(INLINE), ENV);
      const config = "jest.config.cjs";
      expect(seed.projects).toEqual([
        { name: "jest", config, project: "#2" },
        { name: "dup", config, project: "#3" },
        { name: "jest-2", config, project: "#4" },
        { name: "integration", config, project: "integration" },
        { name: "unit", config, project: "unit" },
      ]);
      expect(seed.notes).toContain(
        "Jest config jest.config.cjs lists 5 projects: Squeal seeds each, not the config itself",
      );
      expect(seed.notes).toContain(
        'seeded jest project "unit" from jest.config.cjs (project "unit")',
      );
      expect(seed.notes.join("\n")).not.toMatch(/inline object|^jest project "/m);
    });

    it("seeds a folder glob by its configs and an inline object by the root config", async () => {
      const seed = await seedJest(repo(major, MIXED), tracked(MIXED), ENV);
      expect(seed.projects).toEqual([
        { name: "e2e", config: "jest.config.js", project: "e2e" },
        { name: "alpha", config: "packages/a/jest.config.js" },
      ]);
    });

    it("writes the selector on apply, and reads it back as declared", async () => {
      const root = repo(major, { ...INLINE, "squeal.config.json": json({}) });
      const plan = await buildPlan(root, { env: ENV });
      expect(plan.runners.jest?.map((p) => [p.name, p.project, p.cwd, p.source])).toEqual([
        ["jest", "#2", "", "seed"],
        ["dup", "#3", "", "seed"],
        ["jest-2", "#4", "", "seed"],
        ["integration", "integration", "", "seed"],
        ["unit", "unit", "", "seed"],
      ]);
      const stdout = await setupYes(root);
      expect(stdout).toContain('seeded jest project "unit" in squeal.config.json');
      expect(config(root).jest).toEqual([
        { name: "jest", config: "jest.config.cjs", project: "#2" },
        { name: "dup", config: "jest.config.cjs", project: "#3" },
        { name: "jest-2", config: "jest.config.cjs", project: "#4" },
        { name: "integration", config: "jest.config.cjs", project: "integration" },
        { name: "unit", config: "jest.config.cjs", project: "unit" },
      ]);
      const after = await buildPlan(root, { env: ENV });
      expect(after.runners.jest?.map((p) => [p.name, p.project, p.source])).toEqual([
        ["jest", "#2", "config"],
        ["dup", "#3", "config"],
        ["jest-2", "#4", "config"],
        ["integration", "integration", "config"],
        ["unit", "unit", "config"],
      ]);
    });
  },
);

describe("seedJest without Jest installed (spec 028 D1.2)", () => {
  it("seeds from file names, with a note, and skips a config that may list projects", async () => {
    const files = {
      "packages/a/jest.config.js": "module.exports = {};\n",
      "packages/b/jest.config.js": 'module.exports = { projects: ["<rootDir>/x"] };\n',
    };
    const seed = await seedJest(repo(null, files), tracked(files), ENV);
    expect(seed.projects).toEqual([{ name: "packages/a", config: "packages/a/jest.config.js" }]);
    expect(seed.notes).toEqual([
      "skipped Jest config packages/b/jest.config.js: jest is not installed yet, and the config may list projects only Jest can expand; install jest and run squeal setup again",
      'seeded jest project "packages/a" from packages/a/jest.config.js',
      'jest project "packages/a": jest is not installed yet, so its config was not read; its checks stay unknown until jest 29 or 30 is installed',
    ]);
  });

  it("keeps names unique against other runners' projects", async () => {
    const files = { "jest.config.js": "module.exports = {};\n" };
    const seed = await seedJest(repo(null, files), tracked(files), ENV, new Set(["jest"]));
    expect(seed.projects).toEqual([{ name: "jest-2", config: "jest.config.js" }]);
  });
});

const config = (root: string) =>
  JSON.parse(readFileSync(join(root, "squeal.config.json"), "utf8")) as Record<string, unknown>;

async function setupYes(root: string) {
  const { io, out } = capture(root, { ...harnessEnv(["claude"]), ...ENV });
  const code = await main(["setup", "--yes", "--no-warmup"], io);
  expect(out.stderr).toBe("");
  expect(code).toBe(0);
  return out.stdout;
}

describe("squeal setup and Jest (spec 028 D1.2)", { timeout: 60_000 }, () => {
  it("plans the seeds with notes, reports the missing key, and writes them on apply", async () => {
    const root = repo(30, { ...SAAS, "squeal.config.json": json({ pytest: [] }) });
    const plan = await buildPlan(root, { env: ENV });
    expect(plan.schemaVersion).toBe(1);
    expect(plan.runners.jest?.map((p) => [p.name, p.config, p.cwd, p.source])).toEqual([
      ["packages/core", "packages/core/jest.config.mjs", "packages/core", "seed"],
      ["webapp", "packages/webapp/jest.config.mjs", "packages/webapp", "seed"],
    ]);
    expect(plan.runners.jestNotes?.[0]).toMatch(/^skipped Jest config jest\.config\.mjs: /);
    expect(plan.config.missingKeys).toContain("jest");
    const text = formatPlan(plan);
    expect(text).toContain("Jest packages/core (squeal setup would seed it)");
    expect(text).toContain("  note: skipped Jest config jest.config.mjs: ");

    const stdout = await setupYes(root);
    expect(stdout).toContain('seeded jest project "webapp" in squeal.config.json');
    expect(config(root).jest).toEqual([
      { name: "packages/core", config: "packages/core/jest.config.mjs" },
      { name: "webapp", config: "packages/webapp/jest.config.mjs" },
    ]);
    expect(config(root).pytest).toEqual([]);
    const after = await buildPlan(root, { env: ENV });
    expect(after.runners.jest?.every((p) => p.source === "config")).toBe(true);
    expect(after.config.missingKeys).not.toContain("jest");
  });

  it("keeps a declared jest key as it is", async () => {
    const declared = [{ name: "mine", config: "packages/webapp/jest.config.mjs" }];
    const root = repo(30, { ...SAAS, "squeal.config.json": json({ jest: declared }) });
    const plan = await buildPlan(root, { env: ENV });
    expect(plan.runners.jest).toEqual([
      {
        name: "mine",
        config: "packages/webapp/jest.config.mjs",
        cwd: "packages/webapp",
        source: "config",
        notes: [],
      },
    ]);
    expect(plan.runners.jestNotes).toEqual([]);
    await setupYes(root);
    expect(config(root).jest).toEqual(declared);
  });
});

describe("squeal init --block on a Jest-only repository (spec 028)", { timeout: 60_000 }, () => {
  it("writes a block that names Jest and not Vitest", async () => {
    const files = {
      "package.json": json({ name: "app", private: true }),
      "jest.config.js": 'module.exports = { testEnvironment: "node" };\n',
      "test/a.test.js": TEST,
    };
    const root = repo(30, files);
    const { io, out } = capture(root, { ...harnessEnv(["claude"]), ...ENV });
    const code = await main(["init", "--block", "CLAUDE.md"], io);
    expect(out.stderr).toBe("");
    expect(code).toBe(0);
    const text = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(text).toContain("Squeal runs the Jest tests after each edit.");
    expect(text).toContain("instead of running Jest.");
    expect(text).toContain("run the Jest projects yourself instead.");
    expect(text).not.toContain("Vitest");
  });
});
