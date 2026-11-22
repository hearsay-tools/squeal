import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_COPIED,
  ANTIGRAVITY_MANIFEST,
  antigravityDataDir,
  antigravityPluginDir,
  keepVersion,
  keptCacheCli,
  keptCli,
  keptSkill,
} from "../../../src/harness/shared/version-copies.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Spec 024 D1 and D5 (row 024-02): Antigravity's `plugin install` replaces
 * `~/.gemini/config/plugins/squeal/` in place, so Squeal keeps each
 * version's `dist/`, `skills/` and root `plugin.json` under `$PLUGIN_DATA`
 * with Codex's copy and pruning logic, its manifest and copied entries
 * given as options.
 */

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const manifest = (version: string) => `${JSON.stringify({ name: "squeal", version })}\n`;

/** An Antigravity plugin root of `version` at `root`: `plugin.json` at its root, as installed. */
function plugin(version: string, root = join(tempDir("squeal-agy-root-"), "squeal")): string {
  write(join(root, "plugin.json"), manifest(version));
  write(join(root, "hooks.json"), "{}\n");
  write(join(root, "dist", "cli", "squeal.mjs"), `// ${version}\n`);
  write(join(root, "skills", "squeal", "SKILL.md"), `# Squeal ${version}\n`);
  write(join(root, "bin", "squeal-launcher"), "#!/bin/sh\n# squeal-launcher format 9\n");
  chmodSync(join(root, "bin", "squeal-launcher"), 0o755);
  return root;
}

const LAYOUT = { manifest: ANTIGRAVITY_MANIFEST, copied: ANTIGRAVITY_COPIED };
const CLI = join("dist", "cli", "squeal.mjs");

describe("Antigravity's layout (spec 024 D1)", () => {
  it("names the installed plugin and its data directory under HOME", () => {
    const env = { HOME: "/home/u" };
    expect(antigravityPluginDir(env)).toBe("/home/u/.gemini/config/plugins/squeal");
    expect(antigravityDataDir(env)).toBe("/home/u/.gemini/antigravity-cli/plugin_data/squeal");
    expect(ANTIGRAVITY_MANIFEST).toBe("plugin.json");
    expect(ANTIGRAVITY_COPIED).toEqual(["dist", "skills", "plugin.json"]);
  });
});

describe("keepVersion with Antigravity's manifest and entries", () => {
  it("copies dist/, skills/ and plugin.json, and finds the copy by that manifest", () => {
    const data = join(tempDir("squeal-agy-data-"), "squeal");
    const root = plugin("0.1.600");
    const dir = keepVersion({ root, data, version: "0.1.600", ...LAYOUT });
    expect(dir).toBe(join(data, "versions", "0.1.600"));
    expect(readFileSync(join(dir ?? "", "plugin.json"), "utf8")).toBe(manifest("0.1.600"));
    expect(existsSync(join(dir ?? "", "hooks.json"))).toBe(false);
    expect(existsSync(join(dir ?? "", ".codex-plugin"))).toBe(false);
    expect(keptCli(data, "0.1.600", LAYOUT)).toBe(join(dir ?? "", CLI));
    expect(keptSkill(data, "0.1.600", LAYOUT)).toBe(join(dir ?? "", "skills/squeal/SKILL.md"));
    // Codex's manifest names no version in it.
    expect(keptCli(data, "0.1.600")).toBeNull();
    expect(readFileSync(join(data, "bin", "squeal"), "utf8")).toContain("format 9");
  });

  it("makes no copy from a root whose plugin.json names another version", () => {
    const data = join(tempDir("squeal-agy-data-"), "squeal");
    expect(
      keepVersion({ root: plugin("0.1.599"), data, version: "0.1.600", ...LAYOUT }),
    ).toBeNull();
    expect(existsSync(data)).toBe(false);
  });
});

describe("keptCacheCli for Antigravity's installed CLI (spec 024 D1)", () => {
  it("keeps the copy in PLUGIN_DATA and names its CLI", () => {
    const home = tempDir("squeal-agy-home-");
    const env = { HOME: home };
    const cli = join(plugin("0.1.600", antigravityPluginDir(env)), CLI);
    const data = join(tempDir("squeal-agy-data-"), "squeal");
    expect(keptCacheCli(cli, "0.1.600", { ...env, PLUGIN_DATA: data })).toBe(
      join(data, "versions", "0.1.600", CLI),
    );
    expect(existsSync(join(antigravityDataDir(env), "versions"))).toBe(false);
  });

  it("keeps it in the default data directory without an absolute PLUGIN_DATA", () => {
    const home = tempDir("squeal-agy-home-");
    const env = { HOME: home };
    const cli = join(plugin("0.1.600", antigravityPluginDir(env)), CLI);
    const kept = join(antigravityDataDir(env), "versions", "0.1.600", CLI);
    expect(keptCacheCli(cli, "0.1.600", env)).toBe(kept);
    expect(keptCacheCli(cli, "0.1.600", { ...env, PLUGIN_DATA: "relative/data" })).toBe(kept);
    expect(existsSync(join(antigravityDataDir(env), "bin", "squeal"))).toBe(true);
  });

  it("names the installed CLI when no copy can be kept", () => {
    const home = tempDir("squeal-agy-home-");
    const env = { HOME: home };
    const cli = join(plugin("0.1.600", antigravityPluginDir(env)), CLI);
    expect(keptCacheCli(cli, "0.0.0-unknown", env)).toBe(cli);
    expect(existsSync(antigravityDataDir(env))).toBe(false);
  });

  it("names a CLI elsewhere under .gemini itself", () => {
    const home = tempDir("squeal-agy-home-");
    const cli = join(plugin("0.1.600", join(home, ".gemini", "config", "plugins", "other")), CLI);
    expect(keptCacheCli(cli, "0.1.600", { HOME: home })).toBe(cli);
    expect(existsSync(join(home, ".gemini", "antigravity-cli"))).toBe(false);
  });
});
