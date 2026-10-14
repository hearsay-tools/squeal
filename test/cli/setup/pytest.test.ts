import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { blockText } from "../../../src/cli/setup/block.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import type { AbsolutePath } from "../../../src/core/types/index.js";
import { initRepo } from "../../hash/git-repo.js";
import { capture, cleanupFixtures, harnessEnv, json, scratch } from "./fixture.js";

/*
 * Spec 007 D1's setup paragraph and D8: `squeal setup` seeds a `pytest`
 * entry per detected project, notes a flag D6 refuses in `addopts`, and its
 * block names pytest where it names Vitest and node:test.
 */

afterEach(cleanupFixtures);

/** A Python repository of two pytest projects; the service's `addopts` holds `--lf`. */
function twoProjects(files: Readonly<Record<string, string>> = {}): AbsolutePath {
  const root = scratch("squeal-setup-pytest-") as AbsolutePath;
  initRepo(root, {
    "CLAUDE.md": "# Agents\n",
    "pyproject.toml":
      '[project]\nname = "app"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
    "uv.lock": "",
    "tests/test_app.py": "def test_app():\n    assert True\n",
    "services/api/pytest.ini": "[pytest]\naddopts = -q --lf\n",
    "services/api/tests/test_api.py": "def test_api():\n    assert True\n",
    ...files,
  });
  return root;
}

const PROJECTS = [
  { name: "pytest", include: ["tests/**/test_*.py", "tests/**/*_test.py"] },
  {
    name: "services/api",
    cwd: "services/api",
    include: ["**/test_*.py", "**/*_test.py"],
    exclude: [
      "**/.*/**",
      "**/*.egg/**",
      "**/_darcs/**",
      "**/build/**",
      "**/CVS/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/venv/**",
    ],
  },
];

const REFUSED =
  'pytest project "services/api": Squeal does not run pytest with --lf (in addopts), which change what runs or wait for input; remove it there, or its checks stay unknown';

const config = (root: string) =>
  JSON.parse(readFileSync(join(root, "squeal.config.json"), "utf8")) as Record<string, unknown>;

async function setupYes(root: string) {
  const { io, out } = capture(root, harnessEnv(["claude"]));
  const code = await main(["setup", "--yes", "--no-warmup"], io);
  expect(out.stderr).toBe("");
  expect(code).toBe(0);
  return out.stdout;
}

describe("squeal setup seeds pytest projects (spec 007 D1)", { timeout: 30_000 }, () => {
  it("plans both projects as seeds, with the refused flag's note", async () => {
    const plan = await buildPlan(twoProjects(), { env: {} });
    expect(plan.runners.pytest?.map((p) => [p.name, p.cwd, p.source])).toEqual([
      ["pytest", "", "seed"],
      ["services/api", "services/api", "seed"],
    ]);
    expect(plan.runners.pytest?.[1]?.notes).toContain(REFUSED);
  });

  it("writes both projects into a fresh config and names pytest in the block", async () => {
    const root = twoProjects();
    const stdout = await setupYes(root);
    expect(config(root).pytest).toEqual(PROJECTS);
    expect(stdout).toContain(
      'squeal init: seeded pytest project "services/api" in squeal.config.json',
    );
    expect(stdout).toContain(`squeal init: ${REFUSED}`);
    expect(stdout).toContain(
      "Runners: pytest pytest (squeal setup would seed it), pytest services/api",
    );
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain(
      "Squeal runs the pytest tests after each edit.",
    );
  });

  it("keeps a config's declared pytest projects, and seeds into one without any", async () => {
    const declared = [{ name: "mine", include: ["tests/**"] }];
    const root = twoProjects({ "squeal.config.json": json({ pytest: declared }) });
    await setupYes(root);
    expect(config(root).pytest).toEqual(declared);

    const bare = twoProjects({ "squeal.config.json": json({ slow: { include: [] } }) });
    const plan = await buildPlan(bare, { env: {} });
    expect(plan.config.missingKeys).toContain("pytest");
    expect(plan.outdated).toContain('squeal.config.json has no "pytest" key');
    await setupYes(bare);
    expect(config(bare)).toEqual({ slow: { include: [] }, pytest: PROJECTS });
  });

  it("selects pytest files with a --slow glob", async () => {
    const root = twoProjects();
    const { io, out } = capture(root, harnessEnv(["claude"]));
    const code = await main(["setup", "--yes", "--no-warmup", "--slow", "services/api/tests"], io);
    expect(out.stderr).toBe("");
    expect(code).toBe(0);
    expect(config(root).slow).toMatchObject({ include: ["services/api/tests/**"] });
  });
});

describe("the block with pytest projects (spec 007 D8)", () => {
  it("names pytest beside Vitest and node:test", () => {
    const text = blockText({ vitest: true, nodeTest: true, pytest: true });
    expect(text).toContain("Squeal runs the Vitest, node:test and pytest tests after each edit.");
    expect(text).toContain("instead of running Vitest, node:test or pytest.");
    expect(text).toContain("run `npx vitest run` and the node:test and pytest projects instead.");
  });

  it("names pytest alone without Vitest", () => {
    const text = blockText({ vitest: false, nodeTest: false, pytest: true });
    expect(text).toContain("instead of running pytest. If you have seen no SQUEAL message");
    expect(text).toContain("run the pytest projects yourself instead.");
    expect(text).not.toContain("Vitest");
  });

  it("is unchanged without pytest", () => {
    expect(blockText({ vitest: true, nodeTest: false, pytest: false })).toBe(blockText());
  });
});
