import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { antigravityCli } from "../../../src/cli/antigravity/install.js";
import {
  ANTIGRAVITY_PLUGIN,
  ANTIGRAVITY_PLUGIN_DIR,
  ANTIGRAVITY_PLUGIN_DIST,
  ANTIGRAVITY_SKILL,
  ANTIGRAVITY_SKILL_NOTE,
  noteAntigravityCommand,
  SKILL_SOURCE,
} from "../../../src/harness/antigravity/build.js";
import { LAUNCHER_COPY, REPO_ROOT, rootVersion } from "../../../src/harness/build.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Spec 024 D1, D3 and D4: the native Antigravity plugin's manifest at the
 * plugin root, `hooks.json` beside it (never `hooks/hooks.json`) under group
 * "squeal", `hooks/run` executable, and the build's skill note. When an
 * Antigravity CLI is on the PATH, `plugin validate --json` must report no
 * error and no warning; it runs with a throwaway HOME.
 */

const read = (path: string) => JSON.parse(readFileSync(join(ANTIGRAVITY_PLUGIN_DIR, path), "utf8"));

interface Hook {
  readonly command: string;
  readonly timeout: number;
}

const NODE = "node --disable-warning=ExperimentalWarning";
const EDIT_TOOLS = [
  "write_file",
  "edit_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
];

describe("the Antigravity plugin manifest (spec 024 D1)", () => {
  it("names Squeal at the root version with Marketplace-ready fields", () => {
    const manifest = read("plugin.json");
    expect(manifest).toMatchObject({
      $schema: "https://antigravity.google/schemas/v1/plugin.json",
      name: "squeal",
      displayName: "Squeal",
      version: rootVersion(),
    });
    for (const key of ["description", "repository", "license"]) {
      expect(typeof manifest[key], key).toBe("string");
      expect(manifest[key].length, key).toBeGreaterThan(0);
    }
    expect(manifest.author).toMatchObject({ name: expect.any(String) });
    expect(manifest.keywords).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(manifest.disabled).toBeUndefined();
  });

  it("is the one versioned file the build writes, and the build copies the skill and launcher", () => {
    expect(ANTIGRAVITY_PLUGIN.pluginDir).toBe(join(REPO_ROOT, "plugins/antigravity"));
    expect(ANTIGRAVITY_PLUGIN_DIST).toBe(join(ANTIGRAVITY_PLUGIN_DIR, "dist"));
    expect(ANTIGRAVITY_PLUGIN.entriesDir).toBe("src/harness/antigravity/entries");
    expect(ANTIGRAVITY_PLUGIN.versionedFiles).toEqual(["plugin.json"]);
    expect(ANTIGRAVITY_PLUGIN.copies).toEqual([
      { from: SKILL_SOURCE, to: ANTIGRAVITY_SKILL },
      LAUNCHER_COPY,
    ]);
  });
});

describe("the Antigravity hooks (spec 024 D3)", () => {
  const hooks = read("hooks.json");
  const group = hooks.squeal as Record<string, unknown[]>;

  it("sit at the plugin root under the one group squeal, four events", () => {
    expect(Object.keys(hooks)).toEqual(["squeal"]);
    expect(Object.keys(group).sort()).toEqual([
      "PreInvocation",
      "PreToolUse",
      "SessionStart",
      "Stop",
    ]);
  });

  it("run SessionStart through hooks/run without the fast path, and PreInvocation with it", () => {
    expect(group.SessionStart).toEqual([
      { command: `./hooks/run ${NODE} ./dist/session-start.mjs`, timeout: 2 },
    ]);
    expect(group.PreInvocation).toEqual([
      { command: `./hooks/run --if-squeal ${NODE} ./dist/pre-invocation.mjs`, timeout: 2 },
    ]);
  });

  it("match PreToolUse on the five edit tools and run_command, under a 5 s timeout", () => {
    expect(group.PreToolUse).toEqual([
      {
        matcher: [...EDIT_TOOLS, "run_command"].join("|"),
        hooks: [{ command: `./hooks/run --if-squeal ${NODE} ./dist/pre-tool-use.mjs`, timeout: 5 }],
      },
    ]);
  });

  it("run Stop as stop, then the waiting stop-slow, both behind the fast path", () => {
    expect(group.Stop).toEqual([
      { command: `./hooks/run --if-squeal ${NODE} ./dist/stop.mjs`, timeout: 2 },
      { command: `./hooks/run --if-squeal ${NODE} ./dist/stop-slow.mjs`, timeout: 3600 },
    ]);
  });

  it("name only entries the build makes from src/harness/antigravity/entries", () => {
    const commands = Object.values(group)
      .flat()
      .flatMap((h) => ("hooks" in (h as object) ? (h as { hooks: Hook[] }).hooks : [h as Hook]))
      .map((h) => h.command);
    const entries = commands.map((c) => /\.\/dist\/([a-z-]+)\.mjs$/.exec(c)?.[1]);
    expect(entries.sort()).toEqual([
      "pre-invocation",
      "pre-tool-use",
      "session-start",
      "stop",
      "stop-slow",
    ]);
  });
});

describe("hooks/run (spec 024 D4)", () => {
  it("is executable, in the tree and in git's index", () => {
    const run = join(ANTIGRAVITY_PLUGIN_DIR, "hooks/run");
    expect(statSync(run).mode & 0o755).toBe(0o755);
    const staged = execFileSync("git", ["ls-files", "-s", "--", "plugins/antigravity/hooks/run"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(staged).toMatch(/^100755 /);
    expect(readFileSync(run, "utf8")).toMatch(/^#!\/bin\/sh\n/);
  });
});

describe("the Antigravity skill note (spec 024 D1)", () => {
  it("follows the title and names the launcher, the plugin root's CLI and the kept skill", () => {
    const dir = join(tempDir("squeal-antigravity-skill-"), "squeal");
    cpSync(join(REPO_ROOT, SKILL_SOURCE), dir, { recursive: true });
    noteAntigravityCommand(dir);
    const source = readFileSync(join(REPO_ROOT, SKILL_SOURCE, "SKILL.md"), "utf8");
    const copy = readFileSync(join(dir, "SKILL.md"), "utf8");
    expect(copy).toBe(source.replace("# Squeal\n", `# Squeal\n\n${ANTIGRAVITY_SKILL_NOTE}\n`));
    expect(ANTIGRAVITY_SKILL_NOTE).toContain("`<plugin data>/bin/squeal`");
    expect(ANTIGRAVITY_SKILL_NOTE).toContain(`\`${NODE} "<plugin root>/dist/cli/squeal.mjs"\``);
    expect(ANTIGRAVITY_SKILL_NOTE).toContain("`<plugin data>/versions/<version>/skills/squeal/`");
  });
});

const cli = antigravityCli(process.env);

describe.skipIf(cli === null)("antigravity plugin validate (spec 024 D1)", () => {
  it("reports no error and no warning", () => {
    const home = tempDir("squeal-antigravity-home-");
    const out = execFileSync(cli ?? "", ["plugin", "validate", "--json", ANTIGRAVITY_PLUGIN_DIR], {
      encoding: "utf8",
      timeout: 30_000,
      env: { PATH: process.env.PATH ?? "", HOME: home },
    });
    const report = JSON.parse(out) as {
      components?: { hooks?: number; skills?: number };
      findings?: { severity?: string; file?: string; message?: string }[];
    };
    expect(report.components).toMatchObject({ hooks: 1, skills: 1 });
    const serious = (report.findings ?? []).filter(
      (f) => f.severity === "error" || f.severity === "warning",
    );
    expect(serious).toEqual([]);
  });
});
