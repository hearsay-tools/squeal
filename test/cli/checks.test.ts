import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * Row 005-126: `squeal checks` lists the checks of squeal.config.json in
 * config order, then the default ones, one fact per line, with the last
 * result where a store has one. It needs no daemon and writes nothing.
 */

const CHECKS = [
  { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "edit" },
  { name: "api", runner: "vitest", tests: ["test/api/**"], at: "pause" },
  {
    name: "browser",
    runner: "vitest",
    tests: ["test/browser/**"],
    at: "manual",
    description: "Browser tests; slow, they need Chrome.",
  },
  { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "manual" },
];

/** A repository with `config` as squeal.config.json; with `files`, a store listing them. */
function repo(config: object, files: readonly [string, "pass" | "fail" | "stale"][] = []) {
  const r = fakeRepo();
  writeFileSync(join(r.main, "squeal.config.json"), JSON.stringify(config));
  if (files.length > 0) {
    const store = seedStore(r);
    const id = r.mainId;
    const root = { id, root: r.main, commonDir: r.commonDir, isMain: true, registeredAt: 1 };
    store.worktrees.upsert({ ...root, daemon: null });
    appendRevisions(store, id, 4, { head: null, dirty: false });
    for (const [path, outcome] of files) {
      const testFile = { project: "", path: path as never };
      const key = `key-${path}` as CheckKey;
      const row = { worktreeId: id, testFile, key, revision: 4 as RevisionNumber, pending: null };
      store.testFileKeys.upsertMany([row]);
      const validity = outcome === "stale" ? "stale" : "current";
      const result = outcome === "stale" ? "pass" : outcome;
      store.knownStates.upsertMany([
        state(id, check(path, "works"), { outcome: result, validity, observedAt: 4 }),
      ]);
    }
    store.close();
  }
  return r.main;
}

function run(cwd: string, args: readonly string[] = []) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    cwd,
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  };
  const code = main(["checks", ...args], io);
  return { code, stdout, stderr };
}

describe("squeal checks (row 005-126)", () => {
  it("lists an edit, a between-turns and two manual checks, one described, with no store", () => {
    const { code, stdout, stderr } = run(repo({ checks: CHECKS }));
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe(
      [
        "The checks Squeal runs in this repository (squeal.config.json):",
        "",
        "unit",
        "  Selects: Vitest test files matching test/unit/**",
        "  Runs: after each edit",
        "  Run it now: `squeal run unit --wait 60000`",
        "",
        "api",
        "  Selects: Vitest test files matching test/api/**",
        "  Runs: between your turns: Squeal starts it when your turn ends, not after an edit",
        "  Run it now: `squeal run api --wait 60000`",
        "",
        "browser",
        "  Description: Browser tests; slow, they need Chrome.",
        "  Selects: Vitest test files matching test/browser/**",
        "  Runs: only on request: Squeal does not start it; `squeal run browser --wait 60000` does",
        "  Run it now: `squeal run browser --wait 60000`",
        "",
        "e2e",
        "  Selects: Vitest test files matching test/e2e/**",
        "  Runs: only on request: Squeal does not start it; `squeal run e2e --wait 60000` does",
        "  Run it now: `squeal run e2e --wait 60000`",
        "",
        "tests",
        "  Selects: the test files no other check selects",
        "  Runs: after each edit",
        "  Run it now: `squeal run tests --wait 60000`",
        "",
        "Squeal does not cover typecheck, build or any other test suite: run those yourself.",
        "",
      ].join("\n"),
    );
  });

  it("adds each check's files and last result from the store, and leaves out an empty tests check", () => {
    const root = repo({ checks: CHECKS }, [
      ["test/unit/a.test.ts", "pass"],
      ["test/unit/b.test.ts", "fail"],
      ["test/api/a.test.ts", "stale"],
      ["test/e2e/a.test.ts", "pass"],
    ]);
    const { stdout } = run(root);
    expect(stdout).toContain(
      [
        "unit",
        "  Selects: Vitest test files matching test/unit/**",
        "  Test files now: 2",
        "  Runs: after each edit",
        "  Run it now: `squeal run unit --wait 60000`",
        "  Last result at revision 4: 1 pass, 1 fails",
        "",
        "api",
        "  Selects: Vitest test files matching test/api/**",
        "  Test files now: 1",
        "  Runs: between your turns: Squeal starts it when your turn ends, not after an edit",
        "  Run it now: `squeal run api --wait 60000`",
        "  Last result at revision 4: 1 not current",
        "",
        "browser",
        "  Description: Browser tests; slow, they need Chrome.",
        "  Selects: Vitest test files matching test/browser/**",
        "  Test files now: 0",
      ].join("\n"),
    );
    expect(stdout).toContain("e2e\n");
    expect(stdout).toContain("  Last result at revision 4: 1 pass\n");
    // No test file is left that no check selects.
    expect(stdout).not.toContain("tests\n");
  });

  it("prints the default checks of a config with no checks key", () => {
    const root = repo({ lint: { enabled: true } }, [["test/a.test.ts", "pass"]]);
    const { code, stdout } = run(root);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        "squeal.config.json has no checks key; these are the default checks.",
        "",
        "tests",
        "  Selects: the test files no other check selects",
        "  Test files now: 1",
        "  Runs: after each edit",
        "  Run it now: `squeal run tests --wait 60000`",
        "  Last result at revision 4: 1 pass",
        "",
        "lint",
        "  Selects: lint with eslint and oxlint",
        "  Runs: after each edit, on the edited file",
        "  Findings: `squeal lint`",
        "",
        "Squeal does not cover typecheck, build or any other test suite: run those yourself.",
        "",
      ].join("\n"),
    );
  });

  it("names the slow check where the config marks files slow, and Stop's wait", () => {
    const root = repo({ slow: { include: ["test/slow/**"] }, stop: { requireSlowSuite: true } });
    const { stdout } = run(root);
    expect(stdout).toContain(
      [
        "slow",
        "  Selects: test files marked slow: slow.include test/slow/**",
        "  Runs: after each edit; Stop waits for it",
        "  Starts after: tests",
        "  Run it now: `squeal run slow --wait 60000`",
      ].join("\n"),
    );
    expect(stdout).toContain(
      "  Selects: the test files no other check selects, except those marked slow\n",
    );
  });

  it("refuses an argument", () => {
    const { code, stderr } = run(repo({}), ["--json"]);
    expect(code).toBe(2);
    expect(stderr).toBe('squeal checks: unknown argument "--json"\nUsage: squeal checks\n');
  });

  it("says who starts a check at Stop and one at commit", () => {
    const checks = [
      { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" },
      { name: "style", lint: true, at: "commit", description: "ESLint." },
    ];
    const { stdout } = run(repo({ checks }));
    expect(stdout).toContain(
      "  Runs: at Stop: Squeal starts it when you stop, and Stop waits for it, not after an edit\n",
    );
    expect(stdout).toContain(
      [
        "style",
        "  Description: ESLint.",
        "  Selects: lint, every tool in lint.tools",
        "  Runs: when you commit: Squeal starts it when it sees a new commit, not after an edit",
        "  Run it now: `squeal run style --wait 60000`",
      ].join("\n"),
    );
  });

  it("ends with what Squeal does not run, as the primer says it", () => {
    const root = repo({ vitest: { exclude: ["test/e2e/**"] } });
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
    const { stdout } = run(root);
    expect(stdout).toMatch(
      /\n\nSqueal does not cover typecheck, build, the Vitest test files matching "test\/e2e\/\*\*", which squeal.config.json excludes, or any other test suite: run those yourself.\n$/,
    );
  });
});
