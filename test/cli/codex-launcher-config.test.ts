import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type CodexHookGroup, hookHashes, LAUNCHER_KEY_SOURCE } from "../../src/cli/codex/hash.js";
import { printLauncherConfig } from "../../src/cli/codex/init.js";
import {
  codexPluginData,
  findCodexPlugin,
  isFixedPlugin,
  launcherConfig,
  readPluginHooks,
} from "../../src/cli/codex/launcher.js";
import type { CliIo } from "../../src/cli/main.js";
import { REPO_ROOT } from "../../src/harness/build.js";
import { runtimeDir } from "../harness/bundle-helpers.js";
import { fixedPluginAt } from "./codex-launcher-fixture.js";

/*
 * Spec 002 D1 and D7, rows 002-13 and 002-31: `squeal init --harness codex
 * --print-launcher-config` names the fixed plugin, never a retained runtime,
 * and exports `PLUGIN_ROOT` and `PLUGIN_DATA` in every command, which hooks
 * a launcher declares do not get from Codex.
 */

const PLUGIN = join(REPO_ROOT, "plugins/codex");
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

function print(pluginRoot: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd: runtimeDir(),
    env: {},
  };
  return { code: printLauncherConfig(io, pluginRoot), stdout, stderr, cwd: io.cwd };
}

const commands = (config: Record<string, unknown>) =>
  EVENTS.flatMap((event) =>
    (config[`hooks.${event}`] as CodexHookGroup[]).flatMap((g) => g.hooks.map((h) => h.command)),
  );

describe("squeal init --harness codex --print-launcher-config", () => {
  it("prints hooks.<Event> groups exporting both paths and a matching hooks.state, writing nothing", () => {
    const root = fixedPluginAt(join(runtimeDir(), "plugin"));
    const { code, stdout, stderr, cwd } = print(root);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(readdirSync(cwd)).toEqual([]);

    const config = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(config)).toEqual([...EVENTS.map((e) => `hooks.${e}`), "hooks.state"]);
    const exported = `export PLUGIN_ROOT="${root}" PLUGIN_DATA="${codexPluginData()}"; `;
    expect(commands(config)).toHaveLength(10);
    for (const command of commands(config)) {
      expect(command.startsWith(exported), command).toBe(true);
      expect(command).not.toContain(`\${PLUGIN_ROOT}`);
      expect(command).toContain(`node --disable-warning=ExperimentalWarning "${root}/dist/`);
    }
    const declared = Object.fromEntries(
      EVENTS.map((e) => [e, config[`hooks.${e}`] as CodexHookGroup[]]),
    );
    const state = config["hooks.state"] as Record<string, { trusted_hash: string }>;
    expect(Object.keys(state)).toHaveLength(10);
    for (const key of Object.keys(state)) {
      expect(key).toMatch(/^\/<session-flags>\/config\.toml:[a-z_]+:0:\d+$/);
    }
    const hashes = hookHashes({ hooks: declared }, LAUNCHER_KEY_SOURCE);
    expect(Object.fromEntries(hashes.map((t) => [t.key, { trusted_hash: t.hash }]))).toEqual(state);
  });

  it("keeps every declaration but the command", () => {
    const config = launcherConfig("/opt/squeal/codex", readPluginHooks(PLUGIN), "/var/data");
    const [plain] = config["hooks.Stop"] as CodexHookGroup[];
    expect(plain?.hooks[0]).toEqual({
      type: "command",
      command:
        'export PLUGIN_ROOT="/opt/squeal/codex" PLUGIN_DATA="/var/data"; node --disable-warning=ExperimentalWarning "/opt/squeal/codex/dist/stop.mjs"',
      timeout: 2,
    });
    expect((config["hooks.PreToolUse"] as CodexHookGroup[])[0]?.matcher).toBe("*");
  });

  it("refuses a plugin or data path that cannot sit inside the commands' double quotes", () => {
    const hooks = readPluginHooks(PLUGIN);
    for (const path of ['/a"b', "/a$b", "/a`b", "/a\\b", "/a\nb"]) {
      expect(() => launcherConfig(path, hooks, "/data"), path).toThrow(
        /plugin path.*metacharacter/,
      );
      expect(() => launcherConfig("/root", hooks, path), path).toThrow(
        /plugin data path.*metacharacter/,
      );
    }
  });

  it("gives each hook, run as Codex runs it, both paths, spaces included", () => {
    const dir = join(runtimeDir(), "a b");
    const root = fixedPluginAt(join(dir, "plu gin"), true);
    const data = join(dir, "da ta");
    const repo = join(dir, "re po");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "squeal.config.json"), "{}\n");
    const config = launcherConfig(root, readPluginHooks(root), data);
    const ran = commands(config).map((command) => {
      // Codex runs a hook with `bash -c` in the thread's cwd and sets neither variable here.
      const out = spawnSync("bash", ["-c", command], {
        cwd: repo,
        env: { PATH: process.env.PATH ?? "", HOME: dir, PWD: repo },
        encoding: "utf8",
      });
      expect(out.stderr, command).toBe("");
      return JSON.parse(out.stdout) as { hook: string; root: string; data: string };
    });
    expect(ran.map((r) => r.hook).sort()).toEqual(
      readdirSync(join(root, "dist"))
        .map((f) => f.slice(0, -4))
        .sort(),
    );
    for (const r of ran) expect(r, r.hook).toMatchObject({ root, data });
  });
});

describe("finding the fixed plugin (D7)", () => {
  it("finds the committed fixed plugin from this module", () => {
    expect(isFixedPlugin(PLUGIN)).toBe(true);
    expect(findCodexPlugin()).toBe(PLUGIN);
  });

  it("takes the plugin above its seed, never the seed or a retained runtime", () => {
    const dir = runtimeDir();
    const root = fixedPluginAt(join(dir, "plugin"));
    const cli = (base: string) => pathToFileURL(join(base, "dist", "cli", "squeal.mjs"));
    const empty = { HOME: join(dir, "home") };
    expect(findCodexPlugin(cli(join(root, "seed")), empty)).toBe(root);
    // A retained runtime: a manifest, and a copy from before D7 even holds hooks.json.
    const retained = join(dir, "data", "versions", "0.1.900");
    mkdirSync(join(retained, ".codex-plugin"), { recursive: true });
    writeFileSync(join(retained, ".codex-plugin", "plugin.json"), "{}\n");
    mkdirSync(join(retained, "hooks"));
    writeFileSync(join(retained, "hooks", "hooks.json"), "{}\n");
    expect(isFixedPlugin(retained)).toBe(false);
    expect(findCodexPlugin(cli(retained), empty)).toBe(null);
  });

  it("falls back to the fixed plugin in Codex's cache for a CLI run from a retained runtime", () => {
    const dir = runtimeDir();
    const codexHome = join(dir, "codex");
    const cache = join(codexHome, "plugins", "cache", "hearsay", "squeal");
    const cached = fixedPluginAt(join(cache, "1.0.0"));
    const retained = pathToFileURL(
      join(dir, "data", "versions", "0.1.900", "dist", "cli", "x.mjs"),
    );
    expect(findCodexPlugin(retained, { CODEX_HOME: codexHome })).toBe(cached);
    expect(codexPluginData({ CODEX_HOME: codexHome })).toBe(
      join(codexHome, "plugins", "data", "squeal-hearsay"),
    );
    expect(codexPluginData({ HOME: "/h" })).toBe("/h/.codex/plugins/data/squeal-hearsay");
    expect(codexPluginData({ PLUGIN_DATA: "/p", HOME: "/h" })).toBe("/p");
    // A plugin from before D7 in the cache is no fixed plugin.
    mkdirSync(join(cache, "1.0.1", ".codex-plugin"), { recursive: true });
    expect(findCodexPlugin(retained, { CODEX_HOME: codexHome })).toBe(null);
  });
});
