import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  antigravityCli,
  antigravityInstalls,
  antigravityPluginOf,
  entriesOf,
  scratchTmp,
} from "./antigravity-fixture.js";
import {
  install,
  launcherOf,
  type Machine,
  machine,
  ownedOf,
  snapshot,
} from "./install-fixture.js";

/*
 * Spec 024 D1, `install.sh` with the Antigravity CLI: it detects the CLI
 * (SQUEAL_ANTIGRAVITY_BIN, then agy, then antigravity on the PATH, each only
 * when `--version` prints a bare semver and `help plugin` lists uninstall and
 * validate), unpacks plugins/antigravity/ of its release into a staging
 * directory, and lets `<cli> plugin install` copy it into
 * ~/.gemini/config/plugins/squeal (uninstall:
 * install-antigravity-uninstall.test.ts).
 */

const pluginVersion = (m: Machine) =>
  (
    JSON.parse(readFileSync(join(antigravityPluginOf(m), "plugin.json"), "utf8")) as {
      version: string;
    }
  ).version;

/** The one `plugin install` call, its staging directory under TMPDIR named as the plugin is. */
const installCall = (m: Machine, tool = "agy") =>
  new RegExp(`^${tool} plugin install ${m.env.TMPDIR}/[^/ ]+/squeal$`);

function squeal(m: Machine) {
  const r = m.sh([launcherOf(m)]);
  return { ...(JSON.parse(r.stdout) as { version: string; harness: string }), stderr: r.stderr };
}

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores.
describe("install.sh with Antigravity", { timeout: 30_000 }, () => {
  it("installs the release's plugin through agy plugin install, with Antigravity alone", () => {
    const m = machine([]);
    antigravityCli(m);
    const tmp = scratchTmp(m);
    m.publish("0.1.600");
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const calls = m.calls().filter((c) => !c.endsWith("--version") && !c.endsWith("help plugin"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(installCall(m));
    expect(r.stdout).toContain(`file://${m.hub}/archive/squeal--v0.1.600.tar.gz\n`);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("Next, in each repository: squeal setup");
    expect(pluginVersion(m)).toBe("0.1.600");
    // No staging directory is left, and Antigravity's own config is never written by install.sh.
    expect(entriesOf(tmp)).toEqual([]);
    expect(Object.keys(snapshot(join(m.home, ".gemini")))).not.toContain("config/config.json");
    expect(readFileSync(ownedOf(m), "utf8")).toBe(`antigravity\nlauncher ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(
      readFileSync(join(antigravityPluginOf(m), "bin", "squeal-launcher"), "utf8"),
    );
    expect(squeal(m)).toEqual({ version: "0.1.600", harness: "antigravity", args: [], stderr: "" });
  });

  it("changes nothing on a second run of the same version", () => {
    const m = machine([]);
    antigravityCli(m);
    scratchTmp(m);
    m.publish("0.1.600");
    expect(install(m).status).toBe(0);
    const before = snapshot(m.home);
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls().filter((c) => c.includes("plugin install"))).toEqual([]);
    expect(r.stdout).toContain(`Antigravity has Squeal 0.1.600 from ${antigravityPluginOf(m)}\n`);
    expect(r.stdout).not.toContain("curl");
    expect(snapshot(m.home)).toEqual(before);
  });

  it("updates only Antigravity with --antigravity, as squeal update runs it, and keeps the record", () => {
    const m = machine(["claude"]);
    antigravityCli(m);
    const tmp = scratchTmp(m);
    m.publish("0.1.600");
    expect(install(m).status).toBe(0);
    const launcher = readFileSync(launcherOf(m), "utf8");
    m.publish("0.1.601");
    m.clearLog();
    const r = install(m, "--antigravity");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const calls = m.calls().filter((c) => !c.endsWith("--version") && !c.endsWith("help plugin"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(installCall(m));
    expect(pluginVersion(m)).toBe("0.1.601");
    expect(entriesOf(tmp)).toEqual([]);
    expect(readFileSync(ownedOf(m), "utf8").match(/^antigravity$/gm)).toHaveLength(1);
    // squeal update copies the launcher itself.
    expect(readFileSync(launcherOf(m), "utf8")).toBe(launcher);
  });

  it("updates a plugin that was there before install.sh ran, and does not claim it", () => {
    const m = machine([]);
    antigravityCli(m);
    scratchTmp(m);
    antigravityInstalls(m, "0.1.599");
    m.publish("0.1.600");
    const r = install(m, "--antigravity");
    expect(r.status).toBe(0);
    expect(pluginVersion(m)).toBe("0.1.600");
    expect(existsSync(ownedOf(m))).toBe(false);
  });

  it("rejects the IDE launcher named antigravity, and fails --antigravity naming SQUEAL_ANTIGRAVITY_BIN", () => {
    const m = machine(["claude"]);
    antigravityCli(m, { name: "antigravity", ide: true });
    m.publish("0.1.600");
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls().filter((c) => c.startsWith("antigravity plugin"))).toEqual([]);
    expect(existsSync(antigravityPluginOf(m))).toBe(false);
    expect(readFileSync(ownedOf(m), "utf8")).not.toContain("antigravity");
    const only = install(m, "--antigravity");
    expect(only.status).toBe(1);
    expect(only.stderr).toContain("SQUEAL_ANTIGRAVITY_BIN");
    // With the IDE launcher alone there is no harness to install into.
    const bare = machine([]);
    antigravityCli(bare, { name: "antigravity", ide: true });
    bare.publish("0.1.600");
    const none = install(bare);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("none of claude, codex, pi, opencode and agy is on the PATH");
  });

  it("uses SQUEAL_ANTIGRAVITY_BIN off the PATH before agy", () => {
    const m = machine([]);
    antigravityCli(m);
    m.env.SQUEAL_ANTIGRAVITY_BIN = antigravityCli(m, {
      name: "antigravity",
      dir: join(m.root, "managed"),
    });
    scratchTmp(m);
    m.publish("0.1.600");
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const calls = m.calls().filter((c) => c.includes("plugin install"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(installCall(m, "antigravity"));
    expect(pluginVersion(m)).toBe("0.1.600");
  });

  it("falls back to agy when SQUEAL_ANTIGRAVITY_BIN is not the CLI", () => {
    const m = machine([]);
    antigravityCli(m);
    m.env.SQUEAL_ANTIGRAVITY_BIN = antigravityCli(m, {
      name: "antigravity",
      dir: join(m.root, "ide"),
      ide: true,
    });
    scratchTmp(m);
    m.publish("0.1.600");
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls().filter((c) => c.includes("plugin install"))[0]).toMatch(installCall(m));
  });

  it("names --antigravity in its usage", () => {
    const m = machine();
    const r = install(m, "--yes");
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("usage: install.sh [--uninstall | --pi | --opencode | --antigravity]\n");
  });
});
