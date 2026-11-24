import { appendFileSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  runnerHosts,
  type SpawnedProcess,
  spawnCli,
  waitReady,
} from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";
import { buildPluginDist } from "./spec-026-build.js";

/*
 * Spec 026 row 026-16, Track 1 end to end: one fixture repository under a
 * tiered policy (Vitest at `manual`, oxlint at `edit`, complexity on), its
 * real daemon and the plugin's bundled `squeal` CLI built from this
 * worktree (`spec-026-build.ts`), each step after the last as a
 * developer would take them. Edits to a source and to `README.md` start
 * no Vitest runner host (D1); `squeal run unit --base main --wait` runs
 * only the namesakes of the changed sources and names the importer it
 * left out (D4); `squeal code --base main` says that 0 test groups are in
 * scope and surfaces the stored failure, and `--narrow` runs the narrow
 * set (D5). A second fixture's daemon of an edit-free policy stops by
 * itself, and `squeal status` then says honestly that an edit came after
 * its last pass (D2). No test here reads the real HOME: the CLI and the
 * daemon get a HOME of the fixture's own.
 */

const suite = daemonSuite({}, buildPluginDist);

const OXLINT = realpathSync(resolve(import.meta.dirname, "../../node_modules/oxlint"));

/** The tiered policy: tests only on request, oxlint on every edit, complexity counted. */
function tiered(extra: Record<string, unknown> = {}): Record<string, string> {
  return {
    "squeal.config.json": `${JSON.stringify({
      checks: [
        { name: "unit", runner: "vitest", at: "manual" },
        { name: "lint", lint: ["oxlint"], at: "edit" },
      ],
      lint: { enabled: true, tools: ["oxlint"] },
      complexity: { enabled: true },
      coverage: { enabled: true },
      ...extra,
    })}\n`,
    ".oxlintrc.json": JSON.stringify({ categories: { correctness: "error" } }),
    "README.md": "# fixture\n",
  };
}

/** `repo` with oxlint resolvable and a HOME of its own. */
function prepared(repo: FixtureRepo): FixtureRepo {
  mkdirSync(join(repo.root, "node_modules"), { recursive: true });
  symlinkSync(OXLINT, join(repo.root, "node_modules", "oxlint"));
  const home = join(repo.runtimeDir, "home");
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...repo.env, HOME: home, XDG_STATE_HOME: join(home, "state") };
  for (const name of [
    "CODEX_SESSION_ID",
    "PI_SESSION_ID",
    "OPENCODE_SESSION_ID",
    "ANTIGRAVITY_CONVERSATION_ID",
    "CLAUDECODE",
  ]) {
    delete env[name];
  }
  return { ...repo, env };
}

/** `squeal <args>` in `repo` as its own process: exit code and output. */
async function cli(repo: FixtureRepo, ...args: string[]) {
  const run = spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
  const { code } = await run.exited;
  return { code, out: `${run.stdout()}${run.stderr()}` };
}

/** The exit of `spawned` within 60 s, or `null`. */
const exitOf = (spawned: SpawnedProcess) =>
  Promise.race([spawned.exited, new Promise<null>((done) => setTimeout(() => done(null), 60_000))]);

describe("spec 026 Track 1 end to end (row 026-16)", { timeout: 600_000 }, () => {
  it("keeps Vitest closed on edits, runs the narrow pre-PR set, and gates honestly", async () => {
    const repo = prepared(
      suite.fixture({
        ...tiered({
          runner: { hostIdleMinutes: 1, tierSize: 1 },
          daemon: { unusedExitMinutes: 30 },
        }),
        "test/shout.test.ts":
          'import { expect, it } from "vitest";\nimport { upper } from "../src/strings.ts";\n\nit("shouts", () => {\n  expect(upper("hi") + "!").toBe("HI!");\n});\n',
      }),
    );
    // The branch breaks `upper`: its namesake test and two more importers fail on it.
    git(repo.root, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(
      join(repo.root, "src/strings.ts"),
      "export const upper = (s: string) => s.toLowerCase();\n",
    );
    git(repo.root, ["commit", "-qam", "break upper"]);

    const spawned = suite.daemon(repo);
    await waitReady(repo, spawned);
    const why = () => diagnose(repo, spawned);
    const noHost = (when: string) =>
      expect(runnerHosts(repo.root), `${when}\n${why()}`).toEqual([]);
    await cli(repo, "status", "--wait", "30000");
    noHost("at start");

    // D1: an edit to a source and to README.md opens no runner host; oxlint and complexity run.
    appendFileSync(
      join(repo.root, "src/math.ts"),
      "\nexport const twice = (a: number) => a * 2;\n",
    );
    await cli(repo, "status", "--wait", "30000");
    noHost("after a source edit");
    appendFileSync(join(repo.root, "README.md"), "\nMore words.\n");
    await cli(repo, "status", "--wait", "30000");
    noHost("after a README.md edit");
    const lint = await cli(repo, "lint");
    expect(lint.code, lint.out).toBe(0);
    const code = await cli(repo, "code");
    expect(code.code, code.out).toBe(0);
    noHost("after lint and code reads");

    // D4: the narrow pre-PR run takes the namesakes of the changed sources, one more importer
    // (`runner.tierSize` 1), and names the importer it left out.
    const narrow = await cli(repo, "run", "unit", "--base", "main", "--wait", "180000");
    const base = git(repo.root, ["merge-base", "main", "HEAD"]).trim();
    expect(narrow.out, why()).toContain(
      `Changes since ${base.slice(0, 12)} (merge base of main and HEAD): 3 changed paths.`,
    );
    expect(narrow.out).toMatch(/1 other test file of group unit read/);
    expect(narrow.out).toMatch(/this narrow run did not run (it|them)/);
    expect(narrow.out).toMatch(/README\.md selects? no test file/);
    expect(narrow.out).toContain("test/strings.test.ts");
    expect(narrow.out).not.toMatch(/all tests passed/i);
    expect(narrow.code, narrow.out).not.toBe(0);

    // D5: the default gate leaves the manual group out, says so, and surfaces the stored failure.
    const gate = await cli(repo, "code", "--base", "main");
    expect(gate.out.split("\n")[0], gate.out).toContain(
      "Code gate: incomplete (0 test groups in scope; groups left out: unit (manual); add --group <name>, use --narrow, or set gate.groups).",
    );
    expect(gate.out).toMatch(
      /Left-out test files fail in the stores at this head, not run here: .*test\/strings\.test\.ts \(1 failed test; --group unit runs it\)/,
    );

    // D5: `--narrow` takes the narrow set in scope, with the coverage its run stored, and
    // says that the importer it left out keeps its functions incomplete.
    const gated = await cli(repo, "code", "--base", "main", "--narrow");
    expect(gated.out, why()).not.toContain("0 test groups in scope");
    expect(gated.out).toContain("Vitest: 3 test files selected (unit 3)");
    expect(gated.out).toContain("--narrow left out 1 other selected test file in scope");
    expect(gated.out).toMatch(/src\/strings\.ts:1 +upper +CC 1, coverage 100%/);
    expect(gated.out).toMatch(/test\/strings\.test\.ts: failed: uppercases/);
  });

  it("stops an edit-free daemon when idle and says so honestly after an external edit", async () => {
    const repo = prepared(suite.fixture(tiered({ daemon: { unusedExitMinutes: 0.05 } })));
    const spawned = suite.daemon(repo);
    await waitReady(repo, spawned);
    // No consumer and no test group at edit: the idle bound is capped by the unused one (3 s).
    expect(await exitOf(spawned), diagnose(repo, spawned)).toEqual({ code: 0, signal: null });
    expect(runnerHosts(repo.root)).toEqual([]);

    const quiet = await cli(repo, "status");
    expect(quiet.out.split("\n")[0]).not.toMatch(/^No daemon is running/);
    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const late = 1;\n");
    const stale = await cli(repo, "status");
    expect(stale.out.split("\n")[0]).toMatch(
      /^No daemon is running for this worktree, so these results are as of revision 0\b.*before changes on disk to 1 file \(src\/math\.ts\); the next hook or `squeal start` brings them up to date\.$/,
    );
    // A status read with no daemon starts none.
    expect(runnerHosts(repo.root)).toEqual([]);
  });
});
