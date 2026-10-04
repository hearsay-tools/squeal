import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { fakeRepo } from "../status/helpers.js";
import { outsideGit } from "./bundle-helpers.js";

const MARKETPLACE = {
  source: { source: "github", repo: "hearsay-tools/squeal", path: "plugins/claude-code" },
};

function run(cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = main(["init"], {
    cwd,
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
  });
  return { code, stdout, stderr };
}

const settingsPath = (root: string) => join(root, ".claude", "settings.json");
const readSettings = (root: string): unknown =>
  JSON.parse(readFileSync(settingsPath(root), "utf8"));
const writeSettings = (root: string, text: string) => {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(settingsPath(root), text);
};

describe("squeal init", () => {
  it("writes squeal.config.json with every default and enables the plugin in project settings", () => {
    const { main: root } = fakeRepo();
    mkdirSync(join(root, "src"));

    const out = run(join(root, "src"));

    expect(out).toMatchObject({ code: 0, stderr: "" });
    const config = readFileSync(join(root, "squeal.config.json"), "utf8");
    expect(JSON.parse(config)).toEqual(DEFAULT_POLICY);
    expect(config).toBe(`${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
    expect(readSettings(root)).toEqual({
      extraKnownMarketplaces: { squeal: MARKETPLACE },
      enabledPlugins: { "squeal@squeal": true },
    });
    expect(out.stdout).toBe(
      [
        "squeal init: wrote squeal.config.json with every default policy key",
        "squeal init: added the squeal marketplace to .claude/settings.json",
        "squeal init: enabled squeal@squeal in .claude/settings.json",
        "Each collaborator installs the plugin once: claude plugin install squeal@squeal --scope project",
        "",
      ].join("\n"),
    );
  });

  it("is idempotent: a second run changes no byte", () => {
    const { main: root } = fakeRepo();
    run(root);
    const config = readFileSync(join(root, "squeal.config.json"), "utf8");
    const settings = readFileSync(settingsPath(root), "utf8");

    const out = run(root);

    expect(out.code).toBe(0);
    expect(readFileSync(join(root, "squeal.config.json"), "utf8")).toBe(config);
    expect(readFileSync(settingsPath(root), "utf8")).toBe(settings);
    expect(out.stdout).toContain("squeal init: kept squeal.config.json\n");
    expect(out.stdout).toContain(
      "squeal init: .claude/settings.json already enables squeal@squeal\n",
    );
  });

  it("preserves every unrelated settings key and never writes hook commands", () => {
    const { main: root } = fakeRepo();
    const own = {
      permissions: { allow: ["Bash(npm test:*)"] },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./own-hook.sh" }] }] },
      env: { FOO: "1" },
      enabledPlugins: { "formatter@team": true, "squeal@squeal": false },
      extraKnownMarketplaces: { team: { source: { source: "github", repo: "acme/tools" } } },
    };
    writeSettings(root, JSON.stringify(own, null, 4));

    expect(run(root).code).toBe(0);

    expect(readSettings(root)).toEqual({
      ...own,
      enabledPlugins: { "formatter@team": true, "squeal@squeal": true },
      extraKnownMarketplaces: { ...own.extraKnownMarketplaces, squeal: MARKETPLACE },
    });
  });

  it("adds no hooks key to settings that have none", () => {
    const { main: root } = fakeRepo();
    run(root);
    expect(readFileSync(settingsPath(root), "utf8")).not.toContain('"hooks"');
  });

  it("keeps an existing squeal.config.json and an existing squeal marketplace entry", () => {
    const { main: root } = fakeRepo();
    writeFileSync(join(root, "squeal.config.json"), '{ "stop": { "waitMs": 500 } }\n');
    const local = { source: { source: "directory", path: "/src/squeal/plugins/claude-code" } };
    writeSettings(root, JSON.stringify({ extraKnownMarketplaces: { squeal: local } }));

    const out = run(root);

    expect(readFileSync(join(root, "squeal.config.json"), "utf8")).toBe(
      '{ "stop": { "waitMs": 500 } }\n',
    );
    expect(readSettings(root)).toEqual({
      extraKnownMarketplaces: { squeal: local },
      enabledPlugins: { "squeal@squeal": true },
    });
    expect(out.stdout).toContain("kept the squeal marketplace entry in .claude/settings.json");
  });

  it("changes nothing when settings.json is not a JSON object", () => {
    const { main: root } = fakeRepo();
    writeSettings(root, "{ not json");

    const out = run(root);

    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(/^squeal init: .*\.claude\/settings\.json is not a JSON object/);
    expect(existsSync(join(root, "squeal.config.json"))).toBe(false);
    expect(readFileSync(settingsPath(root), "utf8")).toBe("{ not json");
  });

  it("refuses outside a git worktree", () => {
    const dir = outsideGit();
    const out = run(dir);
    expect(out.code).toBe(1);
    expect(out.stderr).toBe(`squeal init: ${dir} is not inside a git worktree\n`);
  });

  it("rejects arguments", () => {
    const { main: root } = fakeRepo();
    let stderr = "";
    const code = main(["init", "--force"], {
      cwd: root,
      stdout: () => {},
      stderr: (t) => {
        stderr += t;
      },
    });
    expect(code).toBe(2);
    expect(stderr).toMatch(/^squeal init: takes no arguments/);
  });
});
