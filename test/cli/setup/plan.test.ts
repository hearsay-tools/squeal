import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { blockText } from "../../../src/cli/setup/block.js";
import { buildPlan, type SetupPlan } from "../../../src/cli/setup/plan.js";
import { git } from "../../hash/git-repo.js";
import {
  capture,
  cleanupFixtures,
  harnessEnv,
  json,
  SLOW_ONLY_E2E,
  scratch,
  squealShaped,
} from "./fixture.js";

/* Spec 005 D3 step 2, row 005-12: `squeal setup --plan [--json]` reads and writes nothing. */

afterEach(cleanupFixtures);

async function planJson(root: string, env = harnessEnv()): Promise<SetupPlan> {
  const { io, out } = capture(root, env);
  expect(await main(["setup", "--plan", "--json"], io)).toBe(0);
  return JSON.parse(out.stdout) as SetupPlan;
}

describe("squeal setup --plan --json", () => {
  it("reports the facts of a repository shaped like this one", async () => {
    const root = squealShaped();
    const plan = await planJson(root);
    expect(plan).toMatchObject({
      schemaVersion: 1,
      root,
      harnesses: [
        { id: "claude-code", onPath: false, plugin: null },
        { id: "codex", onPath: false, plugin: null },
      ],
      runners: { vitest: true, nodeTest: [] },
      config: {
        path: "squeal.config.json",
        exists: true,
        tracked: true,
        elsewhere: null,
        problems: [],
      },
      codexTrust: { state: "not-checked", command: "squeal init --harness codex --trust" },
      // The Vitest config's include and exclude, read as text: the fixture tree is excluded.
      warmup: { source: "config-text", testFiles: 3, withoutCurrentResult: 3 },
    });
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });

  it("finds the harnesses on the PATH and the plugin a session here loads", async () => {
    const root = squealShaped();
    const env = harnessEnv(["claude", "codex"]);
    const plugins = join(env.HOME as string, ".claude", "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      join(plugins, "installed_plugins.json"),
      json({
        version: 2,
        plugins: {
          "squeal@hearsay": [
            { scope: "project", projectPath: "/elsewhere", version: "0.1.140" },
            { scope: "project", projectPath: root, version: "0.1.132" },
            { scope: "user", version: "0.1.131" },
          ],
        },
      }),
    );
    for (const v of ["0.1.9", "0.1.131", "0.1.12"]) {
      mkdirSync(join(env.HOME as string, ".codex/plugins/cache/hearsay/squeal", v), {
        recursive: true,
      });
    }
    const plan = await planJson(root, env);
    expect(plan.harnesses).toMatchObject([
      { id: "claude-code", onPath: true, plugin: { version: "0.1.132", scope: "project" } },
      { id: "codex", onPath: true, plugin: { version: "0.1.131", scope: "user" } },
    ]);
  });

  it("names install commands for a harness on the PATH without the plugin", async () => {
    const root = squealShaped();
    const { io, out } = capture(root, harnessEnv(["codex"]));
    expect(await main(["setup", "--plan"], io)).toBe(0);
    expect(out.stdout).toContain("codex: on the PATH, plugin not installed");
    expect(out.stdout).toContain("install: codex plugin add squeal@hearsay");
    expect(out.stdout).not.toContain("install: claude");
  });

  it("calls a missing config, an untracked one and one only in the main checkout outdated", async () => {
    const root = squealShaped();
    git(root, ["rm", "-q", "--cached", "squeal.config.json"]);
    git(root, ["commit", "-q", "-m", "untrack"]);
    expect((await planJson(root)).outdated).toEqual([
      "squeal.config.json is not tracked by git: other worktrees run on defaults",
      // Row 005-70: test/e2e names plugins/codex/dist, so it is an exclude candidate.
      'squeal.config.json has no "vitest.exclude" key',
    ]);

    const worktree = join(scratch("squeal-setup-wt-"), "wt");
    git(root, ["worktree", "add", "-q", worktree]);
    const other = await planJson(worktree);
    expect(other.config).toMatchObject({
      exists: false,
      elsewhere: join(root, "squeal.config.json"),
    });
    expect(other.outdated).toEqual([
      `squeal.config.json is only in ${join(root, "squeal.config.json")}: this worktree runs on defaults`,
    ]);

    rmSync(join(root, "squeal.config.json"));
    expect((await planJson(root)).outdated).toEqual([
      "squeal.config.json is missing: worktrees run on defaults",
    ]);
  });

  it("names node:test projects squeal init would seed, and the missing key", async () => {
    const root = squealShaped({
      "package.json": json({ name: "squeal", workspaces: ["packages/*"] }),
      "packages/demo/package.json": json({
        name: "demo",
        scripts: { "test:unit": "node --test test/unit/*.test.js" },
      }),
    });
    const plan = await buildPlan(root, { env: harnessEnv() });
    expect(plan.runners.nodeTest).toEqual([
      { name: "test:unit", cwd: "packages/demo", include: ["test/unit/*.test.js"], source: "seed" },
    ]);
    // test/e2e is an exclude candidate too, so the config lacks both keys (row 005-70).
    expect(plan.config.missingKeys).toEqual(["nodeTest", "vitest.exclude"]);
    const slowOnly = await buildPlan(
      squealShaped({
        ...SLOW_ONLY_E2E,
        "package.json": json({ name: "squeal", workspaces: ["packages/*"] }),
      }),
      { env: harnessEnv() },
    );
    expect(slowOnly.config.missingKeys).toEqual(["slow"]);
  });
});

describe("squeal setup --check and usage", () => {
  it("exits 1 when anything is outdated, 0 when nothing is", async () => {
    const root = squealShaped({
      "squeal.config.json": json({
        slow: { include: ["test/e2e/**/*.test.ts"] },
        inputs: { "test/e2e/*.test.ts": ["plugins/**"] },
      }),
    });
    const ok = capture(root);
    expect(await main(["setup", "--check"], ok.io)).toBe(0);
    expect(ok.out.stdout).toContain("Nothing is outdated.");
    rmSync(join(root, "squeal.config.json"));
    const stale = capture(root);
    expect(await main(["setup", "--check"], stale.io)).toBe(1);
    expect(stale.out.stdout).toContain("Outdated:\n  squeal.config.json is missing");
  });

  it("exits 1 for a tracked config that does not parse or fails validation (review 005-13 S1)", async () => {
    for (const [text, problem] of [
      ["{ invalid\n", "squeal.config.json: not valid JSON"],
      [json({ slwo: {} }), 'squeal.config.json: unknown key "slwo"'],
    ] as const) {
      const root = squealShaped({ "squeal.config.json": text });
      const { io, out } = capture(root);
      expect(await main(["setup", "--check"], io), text).toBe(1);
      expect(out.stdout).toContain(`Outdated:\n  ${problem}`);
      expect(out.stdout).not.toContain("Nothing is outdated.");
    }
  });

  it("says why a gate line is not offered for rewording, and lists what is no gate", async () => {
    const root = squealShaped({
      "CLAUDE.md":
        "```\nnpm test\n```\nRun `CI=1 npm test`.\nThe `npm test` command runs the unit suite.\n",
    });
    const { io, out } = capture(root);
    expect(await main(["setup", "--plan"], io)).toBe(0);
    // Row 005-55: a fenced command and a description are mentions, not gates.
    expect(out.stdout).toContain(
      [
        "  CLAUDE.md:4: Run `CI=1 npm test`.",
        "    runs more than the test command: `CI=1 npm test`: reword it by hand",
        "  The test command where it is no gate (not offered as edits):",
        "    .claude/skills/worker/SKILL.md:1: Run `npx vitest run` and paste it.",
        "    CLAUDE.md:2: npm test",
        "    CLAUDE.md:5: The `npm test` command runs the unit suite.",
      ].join("\n"),
    );
  });

  // Row 005-47: cezar's hand-written Squeal paragraph, beside which setup said "no Squeal block".
  it("names a file that already holds Squeal instructions outside the block", async () => {
    const root = squealShaped({
      "CLAUDE.md": [
        "# Agents",
        "",
        "**If Squeal is installed and validating this worktree, use it for iteration.**",
        "Do not duplicate those background runs with `npm test`,",
        "`npm run test:e2e`, or `npm run test:changed`.",
        "",
      ].join("\n"),
    });
    const plan = await planJson(root);
    expect(plan.squealMentions).toEqual([
      {
        file: "CLAUDE.md",
        line: 3,
        text: "**If Squeal is installed and validating this worktree, use it for iteration.**",
      },
    ]);
    expect(plan.gates).toEqual([]);
    expect(plan.mentions).toContainEqual({
      file: "CLAUDE.md",
      line: 4,
      text: "Do not duplicate those background runs with `npm test`,",
    });
    const { io, out } = capture(root);
    expect(await main(["setup", "--plan"], io)).toBe(0);
    expect(out.stdout).toContain(
      "no Squeal block\n    Squeal already named outside the block, line 3: **If Squeal is installed",
    );
    // The managed block itself is not a mention of Squeal.
    const blocked = squealShaped({ "CLAUDE.md": `# Agents\n\n${blockText()}` });
    expect((await planJson(blocked)).squealMentions).toEqual([]);
  });

  it("takes --plan or --check with --json alone, and setup's own flags without them", async () => {
    const root = squealShaped();
    for (const args of [
      ["--plan", "--force"],
      ["--plan", "--yes"],
      ["--plan", "--check"],
      ["--json"],
      ["--yes", "--harness", "pi"],
      ["--force"],
    ]) {
      const { io, out } = capture(root);
      expect(await main(["setup", ...args], io), args.join(" ")).toBe(2);
      expect(out.stderr).toContain("squeal setup --plan [--json]");
    }
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });

  it("exits 1 outside a git worktree", async () => {
    const { io, out } = capture("/");
    expect(await main(["setup", "--plan"], io)).toBe(1);
    expect(out.stderr).toContain("is not inside a git worktree");
  });
});
