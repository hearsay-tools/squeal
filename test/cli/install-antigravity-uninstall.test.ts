import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  antigravityCli,
  antigravityDataOf,
  antigravityInstalls,
  antigravityKeeps,
  antigravityPluginOf,
} from "./antigravity-fixture.js";
import { install, LAUNCHER, type Machine, machine, ownedOf } from "./install-fixture.js";

/*
 * Spec 024 D1, `install.sh --uninstall` with Antigravity: `<cli> plugin
 * uninstall squeal` only for a plugin install.sh recorded, presence read from
 * ~/.gemini/config/plugins/squeal/plugin.json (the command exits 0 when
 * nothing is installed), and PLUGIN_DATA, which `plugin uninstall` keeps,
 * deleted once no plugin remains and no running process uses it.
 */

/** Antigravity alone, Squeal installed by install.sh, and a session's data directory beside it. */
function installed(): Machine {
  const m = machine([]);
  antigravityCli(m);
  m.publish("0.1.600");
  expect(install(m).status).toBe(0);
  antigravityKeeps(m, "0.1.600", readFileSync(LAUNCHER, "utf8"));
  m.clearLog();
  return m;
}

describe("install.sh --uninstall with Antigravity", { timeout: 30_000 }, () => {
  it("uninstalls the plugin it installed, then deletes the data directory", () => {
    const m = installed();
    const r = install(m, "--uninstall");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls().filter((c) => c.includes(" plugin "))).toEqual([
      "agy plugin uninstall squeal",
    ]);
    expect(r.stdout).toContain(`$ rm -rf ${antigravityDataOf(m)}\n`);
    expect(existsSync(antigravityPluginOf(m))).toBe(false);
    expect(existsSync(antigravityDataOf(m))).toBe(false);
    expect(existsSync(ownedOf(m))).toBe(false);
    // Neither Claude Code nor Codex is here, so no hearsay marketplace was added (lessons.md defect 2).
    expect(r.stdout).not.toContain("marketplace");
  });

  it("keeps a plugin that was there before install.sh ran, and its data directory", () => {
    const m = machine([]);
    antigravityCli(m);
    antigravityInstalls(m, "0.1.600");
    antigravityKeeps(m, "0.1.600", readFileSync(LAUNCHER, "utf8"));
    m.publish("0.1.600");
    expect(install(m).status).toBe(0);
    expect(readFileSync(ownedOf(m), "utf8")).not.toContain("antigravity");
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls().filter((c) => c.includes(" plugin "))).toEqual([]);
    expect(r.stdout).toContain(
      "Antigravity had Squeal before install.sh ran, so it stays; agy plugin uninstall squeal removes it\n",
    );
    expect(existsSync(join(antigravityPluginOf(m), "plugin.json"))).toBe(true);
    expect(existsSync(antigravityDataOf(m))).toBe(true);
  });

  it("keeps the data directory while a process runs from it, and names its removal", async () => {
    const m = installed();
    // As a daemon spawned from a retained copy runs: Node with the copy's CLI as its argument.
    const cli = join(antigravityDataOf(m), "versions", "0.1.600", "dist", "cli", "squeal.mjs");
    const daemon = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", cli, "daemon"], {
      stdio: "ignore",
    });
    try {
      const r = install(m, "--uninstall");
      expect(r.status).toBe(0);
      expect(m.calls().filter((c) => c.includes(" plugin "))).toEqual([
        "agy plugin uninstall squeal",
      ]);
      expect(r.stdout).toContain(
        `Kept ${antigravityDataOf(m)}: a running process uses it; once it ends, rm -rf ${antigravityDataOf(m)} removes it\n`,
      );
      expect(existsSync(antigravityDataOf(m))).toBe(true);
    } finally {
      daemon.kill();
      await new Promise((done) => daemon.once("exit", done));
    }
  });

  it("deletes a data directory left after an earlier plugin uninstall", () => {
    const m = machine(["claude"]);
    antigravityKeeps(m, "0.1.599", readFileSync(LAUNCHER, "utf8"));
    m.publish("0.1.600");
    expect(install(m).status).toBe(0);
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(existsSync(antigravityDataOf(m))).toBe(false);
  });

  it("keeps the plugin and its record when no Antigravity CLI is on the PATH", () => {
    const m = installed();
    rmSync(join(m.root, "stubs", "agy"));
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `no Antigravity CLI is on the PATH, so Squeal stays in Antigravity and in ${ownedOf(m)}; set SQUEAL_ANTIGRAVITY_BIN to the CLI's path to remove it\n`,
    );
    expect(existsSync(join(antigravityPluginOf(m), "plugin.json"))).toBe(true);
    expect(existsSync(antigravityDataOf(m))).toBe(true);
    expect(readFileSync(ownedOf(m), "utf8")).toBe("antigravity\n");
  });

  // Review 0.1.601 B1: updating a pre-existing plugin with a non-numeric or missing version must stay unowned on uninstall.
  it.each([
    ["a prerelease version", JSON.stringify({ name: "squeal", version: "0.1.599-local" })],
    ["no version field", JSON.stringify({ name: "squeal" })],
  ])("preserves a pre-existing plugin updated from %s", (_, manifest) => {
    const m = machine([]);
    antigravityCli(m);
    mkdirSync(antigravityPluginOf(m), { recursive: true });
    writeFileSync(join(antigravityPluginOf(m), "plugin.json"), `${manifest}\n`);
    m.publish("0.1.600");
    expect(install(m, "--antigravity").status).toBe(0);
    expect(existsSync(ownedOf(m))).toBe(false);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls().filter((c) => c.includes(" plugin "))).toEqual([]);
    expect(existsSync(join(antigravityPluginOf(m), "plugin.json"))).toBe(true);
  });

  it("forgets a recorded plugin that is gone, and runs no uninstall", () => {
    const m = installed();
    rmSync(antigravityPluginOf(m), { recursive: true });
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls().filter((c) => c.includes(" plugin "))).toEqual([]);
    expect(existsSync(ownedOf(m))).toBe(false);
    expect(existsSync(antigravityDataOf(m))).toBe(false);
  });
});
