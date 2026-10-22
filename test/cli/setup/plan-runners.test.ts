import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import type { SetupPlan } from "../../../src/cli/setup/plan.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/index.js";
import type { CheckKey, RevisionNumber } from "../../../src/core/types/index.js";
import { git } from "../../hash/git-repo.js";
import { state } from "../../status/helpers.js";
import {
  capture,
  cleanupFixtures,
  json,
  squealShaped,
  TOOLKIT_PYTEST,
  toolkitShaped,
} from "./fixture.js";

/*
 * Rows 005-79 and 005-80, 005 D3 step 2 as amended 2026-10-22: the plan
 * lists Vitest as 003 D7 detects it, and names what the config leaves out or
 * runs twice, each with its fix, without changing `--check`'s exit status.
 */

afterEach(cleanupFixtures);

async function run(root: string, args: readonly string[]) {
  const { io, out } = capture(root);
  const code = await main(["setup", ...args], io);
  return { code, stdout: out.stdout };
}

async function planJson(root: string): Promise<SetupPlan> {
  const { code, stdout } = await run(root, ["--plan", "--json"]);
  expect(code).toBe(0);
  return JSON.parse(stdout) as SetupPlan;
}

const lines = (text: string) => text.split("\n");

const REFUSED =
  'script "test:node" in package.json is not `node [flags...] --test <globs...>` (a chain); add its nodeTest entry by hand from the template below';

describe("the plan on a repository shaped like toolkit-dev", () => {
  it("lists no Vitest, and names the one below the root with why and the fix", async () => {
    const root = toolkitShaped();
    const { stdout } = await run(root, ["--plan"]);
    expect(lines(stdout)).toContain("Runners: pytest root, pytest plugin-tools-a");
    const named = lines(stdout).filter((line) => line.includes("tools/generator"));
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/^ {2}not run: /);
    expect(named[0]).toContain("loads Vitest from the root only");
    expect(named[0]).toContain("projects name tools/generator");
    expect(named[0]).toContain("vitest to the root package.json");
    const plan = await planJson(root);
    expect(plan.runners).toMatchObject({ vitest: false, vitestBelowRoot: ["tools/generator"] });
  });

  it("shows the seed's note and template for the refused test:node while nodeTest is empty", async () => {
    const root = toolkitShaped();
    const { stdout } = await run(root, ["--plan"]);
    expect(stdout).toContain(`  not run: ${REFUSED}\n`);
    expect(stdout).toContain('"<test-file glob>"');
    const plan = await planJson(root);
    expect(plan.runners.nodeTestLeftOut).toEqual({
      notes: [REFUSED],
      templates: [{ name: "test:node", argv: [], include: ["<test-file glob>"] }],
    });
  });

  it("names a script the seed would take as left out while nodeTest is empty", async () => {
    const root = toolkitShaped({
      "package.json": json({
        scripts: { "test:scripts": "node --test .github/scripts/*.test.js" },
      }),
    });
    const plan = await planJson(root);
    expect(plan.runners.nodeTest).toEqual([]);
    expect(plan.runners.nodeTestLeftOut).toEqual({
      notes: [
        'script "test:scripts" in package.json runs node --test, and squeal.config.json declares no node:test project; add its nodeTest entry from the template below',
      ],
      templates: [{ name: "test:scripts", argv: [], include: [".github/scripts/*.test.js"] }],
    });
  });

  it("hides the refusal once the config declares a node:test project", async () => {
    const declared = [{ name: "scripts", include: [".github/scripts/*.test.js"] }];
    const root = toolkitShaped({
      "squeal.config.json": json({ nodeTest: declared, pytest: TOOLKIT_PYTEST }),
    });
    const { stdout } = await run(root, ["--plan"]);
    expect(stdout).not.toContain("test:node");
    expect((await planJson(root)).runners.nodeTestLeftOut).toEqual({ notes: [], templates: [] });
  });

  it("names the test files both pytest projects select, with the fix, on one line", async () => {
    const root = toolkitShaped();
    const { stdout } = await run(root, ["--plan"]);
    const twice = lines(stdout).filter((line) => line.startsWith("  run twice: "));
    expect(twice).toEqual([
      '  run twice: 2 test files that pytest projects "root" and "plugin-tools-a" both select; to run each once, add "plugin-tools/a/**" to the exclude of pytest project "root"',
    ]);
    expect((await planJson(root)).runners.pytestOverlaps).toEqual([
      {
        projects: ["root", "plugin-tools-a"],
        testFiles: 2,
        fix: 'add "plugin-tools/a/**" to the exclude of pytest project "root"',
      },
    ]);
  });

  it("asks either of two projects in one directory to give the shared files up", async () => {
    const pytest = [
      { name: "unit", include: ["tests/**/test_*.py"] },
      { name: "all", include: ["**/test_*.py"] },
    ];
    const root = toolkitShaped({ "squeal.config.json": json({ nodeTest: [], pytest }) });
    expect((await planJson(root)).runners.pytestOverlaps).toEqual([
      {
        projects: ["unit", "all"],
        testFiles: 1,
        fix: 'keep each test file in one project: narrow the include of pytest project "all" or add the shared files to its exclude',
      },
    ]);
  });

  it("estimates the warm-up per project and test file, Vitest below the root left out", async () => {
    const plan = await planJson(toolkitShaped());
    // root: tests/test_root.py and plugin-tools/a's two; plugin-tools-a: its two.
    expect(plan.warmup).toMatchObject({ testFiles: 5, paths: 3, withoutCurrentResult: 5 });
  });

  it("counts the warm-up per project and test file from the store, never below zero", async () => {
    const root = toolkitShaped();
    const id = worktreeIdFor(root);
    const store = openStore(join(root, ".git"), { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
    const listed = [
      ["root", "tests/test_root.py"],
      ["root", "plugin-tools/a/tests/test_one.py"],
      ["plugin-tools-a", "plugin-tools/a/tests/test_one.py"],
    ] as const;
    try {
      store.testFileKeys.upsertMany(
        listed.map(([project, path]) => ({
          worktreeId: id,
          testFile: { project, path: path as never },
          key: `key-${project}-${path}` as CheckKey,
          revision: 1 as RevisionNumber,
          pending: null,
        })),
      );
      store.knownStates.upsertMany(
        listed.map(([project, path]) =>
          state(id, { kind: "file", project, testPath: path as never }),
        ),
      );
    } finally {
      store.close();
    }
    const plan = await planJson(root);
    expect(plan.warmup).toEqual({
      source: "store",
      testFiles: 3,
      paths: 2,
      withoutCurrentResult: 0,
    });
    const { stdout } = await run(root, ["--plan"]);
    expect(stdout).toContain(
      "Warm-up: runs all 3 test files, one run per project and file (2 paths), 0 without a current result\n",
    );
  });

  it("leaves --check's exit status to what is outdated", async () => {
    const root = toolkitShaped();
    expect((await run(root, ["--check"])).code).toBe(0);
    const { code, stdout } = await run(root, ["--check", "--json"]);
    expect(code).toBe(0);
    const plan = JSON.parse(stdout) as SetupPlan;
    expect(plan.outdated).toEqual([]);
    expect(plan.runners.vitestBelowRoot).toEqual(["tools/generator"]);
  });
});

describe("the plan on a repository with Vitest at the root", () => {
  it("prints the runners and the warm-up as before, with nothing left out", async () => {
    const root = squealShaped();
    const { stdout } = await run(root, ["--plan"]);
    expect(lines(stdout)).toContain("Runners: Vitest");
    expect(stdout).not.toMatch(/not run: |run twice: /);
    expect(stdout).toContain(
      "Warm-up: runs all 3 test files, 3 without a current result (estimated: no daemon has listed them)\n",
    );
    const plan = await planJson(root);
    expect(plan.runners).toMatchObject({
      vitest: true,
      vitestBelowRoot: [],
      nodeTestLeftOut: { notes: [], templates: [] },
      pytestOverlaps: [],
    });
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });
});
