import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  install,
  LAUNCHER,
  launcherOf,
  type Machine,
  machine,
  snapshot,
} from "./install-fixture.js";

/*
 * Spec 005 D3, `install.sh --uninstall` removing only what `install.sh` created
 * (review wave 2, B3): it records each plugin and launcher in
 * ~/.local/state/squeal/installed, outside ~/.claude and ~/.codex.
 */

const OWNED = (m: Machine) => join(m.home, ".local", "state", "squeal", "installed");

/** The plugin installed through the harness's own CLI before `install.sh` runs. */
function pluginFirst(m: Machine, h: "claude" | "codex") {
  const add = h === "claude" ? "install" : "add";
  const r = m.sh([
    "-c",
    `${h} plugin marketplace add "$SQUEAL_MARKETPLACE" && ${h} plugin ${add} squeal@hearsay`,
  ]);
  expect(r.status).toBe(0);
}

const claudeEntries = (m: Machine) =>
  JSON.parse(readFileSync(join(m.claudeConfig, "plugins", "installed_plugins.json"), "utf8"))
    .plugins as Record<string, unknown>;
const codexHas = (m: Machine) =>
  existsSync(join(m.codexHome, "plugins", "cache", "hearsay", "squeal"));

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores, past 5 s under the full suite.
describe("install.sh --uninstall", { timeout: 30_000 }, () => {
  it("removes the launcher and the plugin from each harness it installed in", () => {
    const m = machine();
    m.publish("0.1.134");
    const empty = snapshot(m.home);
    expect(install(m).status).toBe(0);
    expect(readFileSync(OWNED(m), "utf8")).toBe(`claude\ncodex\nlauncher ${launcherOf(m)}\n`);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin uninstall squeal@hearsay",
      "codex plugin remove squeal@hearsay",
    ]);
    expect(existsSync(launcherOf(m))).toBe(false);
    // What stays is the marketplace each harness added, which the script says how to remove.
    expect(
      Object.keys(snapshot(m.home))
        .filter((f) => !(f in empty))
        .sort(),
    ).toEqual([
      ".claude/plugins/installed_plugins.json",
      ".claude/plugins/known_marketplaces.json",
      ".codex/stub-marketplaces.json",
    ]);
    expect(claudeEntries(m)).toEqual({});
    expect(existsSync(join(m.home, ".local", "state", "squeal"))).toBe(false);
    expect(r.stdout).toContain("claude plugin marketplace remove hearsay");
    // A second uninstall finds nothing; an install afterwards works with the marketplace still added.
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(install(m).status).toBe(0);
    expect(m.calls()).toContain("codex plugin add squeal@hearsay");
    expect(readFileSync(OWNED(m), "utf8")).toBe(`claude\ncodex\nlauncher ${launcherOf(m)}\n`);
  });

  it.each([["claude"], ["codex"]] as const)(
    "keeps a %s plugin that was there before, and says how to remove it",
    (h) => {
      const m = machine([h]);
      m.publish("0.1.134");
      pluginFirst(m, h);
      m.clearLog();
      expect(install(m).status).toBe(0);
      expect(m.calls()).toEqual([]);
      const r = install(m, "--uninstall");
      expect(r.status).toBe(0);
      expect(m.calls()).toEqual([]);
      if (h === "claude") expect(claudeEntries(m)["squeal@hearsay"]).toBeDefined();
      else expect(codexHas(m)).toBe(true);
      const remove = h === "claude" ? "uninstall" : "remove";
      expect(r.stdout).toContain(
        `had squeal@hearsay before install.sh ran, so it stays; ${h} plugin ${remove} squeal@hearsay removes it`,
      );
      // The launcher it copied is its own.
      expect(existsSync(launcherOf(m))).toBe(false);
    },
  );

  it("removes only the plugin it installed on a machine with one harness's plugin already there", () => {
    const m = machine();
    m.publish("0.1.134");
    pluginFirst(m, "claude");
    m.clearLog();
    expect(install(m).status).toBe(0);
    expect(m.calls()).toEqual([
      `codex plugin marketplace add file://${m.hub}`,
      "codex plugin add squeal@hearsay",
    ]);
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    expect(m.calls()).toEqual(["codex plugin remove squeal@hearsay"]);
    expect(claudeEntries(m)["squeal@hearsay"]).toBeDefined();
    expect(codexHas(m)).toBe(false);
  });

  it("keeps a launcher that was there before, updated or not", () => {
    const m = machine();
    m.publish("0.1.134");
    mkdirSync(join(m.home, ".local", "bin"), { recursive: true });
    const older = readFileSync(LAUNCHER, "utf8").replace("\n", "\n# an older copy\n");
    writeFileSync(launcherOf(m), older, { mode: 0o755 });
    expect(install(m).status).toBe(0);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(readFileSync(LAUNCHER, "utf8"));
    expect(readFileSync(OWNED(m), "utf8")).toBe("claude\ncodex\n");
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(existsSync(launcherOf(m))).toBe(true);
    expect(r.stdout).toContain(`${launcherOf(m)} was there before install.sh ran, so it stays`);
    expect(m.calls().slice(-2)).toEqual([
      "claude plugin uninstall squeal@hearsay",
      "codex plugin remove squeal@hearsay",
    ]);
  });

  it("keeps ownership across a repeated install", () => {
    const m = machine();
    m.publish("0.1.134");
    expect(install(m).status).toBe(0);
    const owned = readFileSync(OWNED(m), "utf8");
    expect(install(m).status).toBe(0);
    expect(readFileSync(OWNED(m), "utf8")).toBe(owned);
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    expect(m.calls()).toHaveLength(2);
    expect(existsSync(launcherOf(m))).toBe(false);
  });

  it("keeps what it installed before a harness failed, and removes it after the retry", () => {
    const m = machine();
    m.publish("0.1.134");
    m.env.STUB_FAIL = "codex plugin add";
    const failed = install(m);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("installing squeal@hearsay in Codex failed");
    expect(readFileSync(OWNED(m), "utf8")).toBe("claude\n");
    delete m.env.STUB_FAIL;
    m.clearLog();
    expect(install(m).status).toBe(0);
    // The marketplace stays added from the failed run; the install shows it is there.
    expect(m.calls()).toEqual([
      `codex plugin marketplace add file://${m.hub}`,
      "codex plugin add squeal@hearsay",
    ]);
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin uninstall squeal@hearsay",
      "codex plugin remove squeal@hearsay",
    ]);
    expect(existsSync(OWNED(m))).toBe(false);
  });

  it("keeps a recorded plugin when its harness is no longer on the PATH", () => {
    const m = machine();
    m.publish("0.1.134");
    expect(install(m).status).toBe(0);
    m.env.PATH = m.env.PATH?.split(":").slice(1).join(":") ?? "";
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("claude is not on the PATH, so squeal@hearsay stays in Claude Code");
    expect(readFileSync(OWNED(m), "utf8")).toBe("claude\ncodex\n");
  });
});
