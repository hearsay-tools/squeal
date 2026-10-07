import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type CodexHookGroup, hookHashes, LAUNCHER_KEY_SOURCE } from "../../src/cli/codex/hash.js";
import { findCodexPlugin, launcherConfig, readPluginHooks } from "../../src/cli/codex/launcher.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runtimeDir } from "../harness/bundle-helpers.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";

/* Spec 002 D1, D6 and goal 8: `squeal init --harness codex` and the Codex status line. */

const PLUGIN = join(REPO_ROOT, "plugins/codex");
/** tsx's loader by URL, since the CLI runs in a directory with no node_modules. */
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "Interrupt",
  "SessionEnd",
];

function run(argv: string[], cwd: string, env: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env,
  };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

/** Every file under `dir`, relative, with its content. */
function snapshot(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[path.slice(dir.length)] = readFileSync(path, "utf8");
  }
  return files;
}

describe("squeal init --harness codex", () => {
  it("writes squeal.config.json, prints the plugin commands and the trust step, and no Claude settings", () => {
    const repo = fakeRepo();
    const { code, stdout, stderr } = run(["init", "--harness", "codex"], repo.main);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(readFileSync(join(repo.main, "squeal.config.json"), "utf8"))).toEqual(
      DEFAULT_POLICY,
    );
    expect(existsSync(join(repo.main, ".claude"))).toBe(false);
    expect(stdout).toContain("wrote squeal.config.json");
    expect(stdout).toContain("codex plugin marketplace add hearsay-tools/squeal\n");
    expect(stdout).toContain("codex plugin add squeal@squeal\n");
    expect(stdout).toContain("/hooks");
  });

  it("keeps an existing squeal.config.json", () => {
    const repo = fakeRepo();
    writeFileSync(join(repo.main, "squeal.config.json"), "{}\n");
    const { code, stdout } = run(["init", "--harness=codex"], repo.main);
    expect(code).toBe(0);
    expect(stdout).toContain("kept squeal.config.json");
    expect(readFileSync(join(repo.main, "squeal.config.json"), "utf8")).toBe("{}\n");
  });

  it("touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI", () => {
    const repo = fakeRepo();
    const home = runtimeDir();
    const codexHome = join(home, "codex-home");
    mkdirSync(join(home, ".codex"));
    mkdirSync(codexHome);
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "x"\n');
    writeFileSync(join(codexHome, "config.toml"), 'model = "y"\n');
    const before = snapshot(home);
    const env = { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: codexHome };
    const cli = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          TSX,
          join(REPO_ROOT, "src/cli/index.ts"),
          "init",
          "--harness",
          "codex",
          ...args,
        ],
        { cwd: repo.main, env, encoding: "utf8" },
      );
    const first = cli([]);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(cli(["--print-launcher-config"]).status).toBe(0);
    expect(snapshot(home)).toEqual(before);
    expect(existsSync(join(repo.main, "squeal.config.json"))).toBe(true);
  });

  it("rejects an unknown harness, a stray argument and the launcher flag without codex", () => {
    const repo = fakeRepo();
    for (const args of [
      ["--harness", "pi"],
      ["--harness"],
      ["--harness", "codex", "--force"],
      ["--print-launcher-config"],
    ]) {
      const { code, stderr } = run(["init", ...args], repo.main);
      expect(code, args.join(" ")).toBe(2);
      expect(stderr, args.join(" ")).toMatch(/^squeal init: takes no arguments but those below; /);
    }
    expect(existsSync(join(repo.main, "squeal.config.json"))).toBe(false);
  });

  it("keeps the Claude Code behaviour under --harness claude-code", () => {
    const repo = fakeRepo();
    expect(run(["init", "--harness", "claude-code"], repo.main).code).toBe(0);
    expect(existsSync(join(repo.main, ".claude", "settings.json"))).toBe(true);
  });
});

describe("squeal init --harness codex --print-launcher-config", () => {
  it("prints thread/start config: hooks.<Event> groups and a matching hooks.state, writing nothing", () => {
    const cwd = runtimeDir();
    const { code, stdout, stderr } = run(
      ["init", "--harness", "codex", "--print-launcher-config"],
      cwd,
    );
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(readdirSync(cwd)).toEqual([]);

    const config = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(config)).toEqual([...EVENTS.map((e) => `hooks.${e}`), "hooks.state"]);
    const declared: Record<string, readonly CodexHookGroup[]> = {};
    for (const event of EVENTS) {
      const groups = config[`hooks.${event}`] as CodexHookGroup[];
      declared[event] = groups;
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook.type).toBe("command");
          expect(typeof hook.timeout).toBe("number");
          expect(hook.command).not.toContain("PLUGIN_ROOT");
          expect(hook.command).toContain(`"${PLUGIN}/dist/`);
        }
      }
    }
    const state = config["hooks.state"] as Record<string, { trusted_hash: string }>;
    expect(Object.keys(state)).toHaveLength(EVENTS.length);
    for (const key of Object.keys(state)) {
      expect(key).toMatch(/^\/<session-flags>\/config\.toml:[a-z_]+:0:0$/);
    }
    expect(
      Object.fromEntries(
        hookHashes({ hooks: declared }, LAUNCHER_KEY_SOURCE).map((t) => [
          t.key,
          { trusted_hash: t.hash },
        ]),
      ),
    ).toEqual(state);
  });

  it("finds the plugin from this module, and keeps every declaration but the command", () => {
    expect(findCodexPlugin()).toBe(PLUGIN);
    const hooks = readPluginHooks(PLUGIN);
    const config = launcherConfig("/opt/squeal/plugins/codex", hooks);
    const [plain] = config["hooks.Stop"] as CodexHookGroup[];
    expect(plain?.hooks[0]).toEqual({
      type: "command",
      command: 'node "/opt/squeal/plugins/codex/dist/stop.mjs"',
      timeout: 2,
    });
    expect((config["hooks.PreToolUse"] as CodexHookGroup[])[0]?.matcher).toBe("*");
  });

  it("refuses a plugin path that cannot sit inside the commands' double quotes", () => {
    const hooks = readPluginHooks(PLUGIN);
    for (const path of ['/a"b', "/a$b", "/a`b", "/a\\b"]) {
      expect(() => launcherConfig(path, hooks), path).toThrow(/shell metacharacter/);
    }
  });
});

describe("squeal status in a Codex shell (spec 002 D6)", () => {
  const LINE =
    /^Codex: Squeal's hooks have not run in this session \(no consumer for CODEX_SESSION_ID thread-1\)\..*\/hooks/m;

  function storeRepo(sessions: string[]) {
    const repo = fakeRepo();
    const store = seedStore(repo);
    appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
    for (const sessionId of sessions) {
      store.consumers.register({ worktreeId: repo.mainId, sessionId, agentId: "main" }, 1);
    }
    store.close();
    return repo;
  }

  it("adds the line when CODEX_SESSION_ID has no consumer", () => {
    const repo = storeRepo(["thread-other"]);
    const { code, stdout } = run(["status"], repo.main, { CODEX_SESSION_ID: "thread-1" });
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Revision: 1/);
    expect(stdout).toMatch(LINE);
  });

  it("adds it when no store exists either", () => {
    const { stdout } = run(["status"], fakeRepo().main, { CODEX_SESSION_ID: "thread-1" });
    expect(stdout).toMatch(/^Status unavailable/);
    expect(stdout).toMatch(LINE);
  });

  it("stays silent when the session is registered, outside Codex, and in --json", () => {
    const registered = storeRepo(["thread-1"]);
    expect(run(["status"], registered.main, { CODEX_SESSION_ID: "thread-1" }).stdout).not.toMatch(
      /Codex/,
    );
    const unregistered = storeRepo([]);
    expect(run(["status"], unregistered.main).stdout).not.toMatch(/Codex/);
    const json = run(["status", "--json"], unregistered.main, { CODEX_SESSION_ID: "thread-1" });
    expect(() => JSON.parse(json.stdout)).not.toThrow();
  });
});
