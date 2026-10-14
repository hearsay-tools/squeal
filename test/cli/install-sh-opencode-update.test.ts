import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  install,
  launcherOf,
  type Machine,
  machine,
  openCodeDirOf,
  openCodeHomeOf,
  openCodeLinkOf,
  openCodePluginsOf,
  ownedOf,
} from "./install-fixture.js";

/*
 * Spec 008 D1, an update of Squeal in OpenCode by a later release's
 * `install.sh`: the new directory is unpacked and `current` repointed at it,
 * with no `opencode` call, since the config names the link
 * (research/wave-0-checks.md 3). The directory before it stays on disk, as
 * does an older one a running process names, because an open session's
 * bridge runs from the directory it loaded.
 */

const squealVersion = (m: Machine) =>
  (JSON.parse(m.sh([launcherOf(m)]).stdout) as { version: string }).version;

/** A machine with OpenCode alone, where install.sh installed each release in turn. */
function updatedThrough(...versions: string[]): Machine {
  const m = machine(["opencode"]);
  for (const v of versions) {
    m.publish(v);
    const r = install(m);
    expect(r.status, r.stderr).toBe(0);
  }
  m.clearLog();
  return m;
}

const RESTART =
  "OpenCode sessions already open keep the Squeal they loaded until they restart. " +
  "Restart them before the next update: it removes the version they loaded unless its daemon is running\n";

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores.
describe("install.sh updating Squeal in OpenCode", { timeout: 60_000 }, () => {
  it("unpacks the new directory and repoints current, keeping the old one and the one config entry", () => {
    const m = updatedThrough("0.1.176");
    const old = openCodeDirOf(m);
    m.publish("0.1.177");
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(`$ ln -sfn 0.1.177 ${openCodeLinkOf(m)}\n`);
    expect(r.stdout).not.toContain("rm -rf");
    expect(r.stdout).toContain(RESTART);
    expect(readlinkSync(openCodeLinkOf(m))).toBe("0.1.177");
    expect(readdirSync(openCodeHomeOf(m)).sort()).toEqual(["0.1.176", "0.1.177", "current"]);
    expect(openCodePluginsOf(m)).toEqual([`file:${openCodeLinkOf(m)}`]);
    // An open session's bridge and its primer's CLI are still there.
    expect(readFileSync(join(old, "dist", "cli", "squeal.mjs"), "utf8")).toContain("0.1.176");
    expect(readFileSync(ownedOf(m), "utf8")).toBe(
      `opencode ${old}\nopencode\nlauncher ${launcherOf(m)}\nopencode ${openCodeDirOf(m)}\n`,
    );
    expect(squealVersion(m)).toBe("0.1.177");
  });

  it("keeps exactly one previous directory over several updates, and a second run changes nothing", () => {
    const m = updatedThrough("0.1.176", "0.1.177");
    m.publish("0.1.178");
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(`$ rm -rf ${openCodeDirOf(m, "0.1.176")}\n`);
    expect(readdirSync(openCodeHomeOf(m)).sort()).toEqual(["0.1.177", "0.1.178", "current"]);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(
      `opencode\nlauncher ${launcherOf(m)}\nopencode ${openCodeDirOf(m, "0.1.177")}\nopencode ${openCodeDirOf(m)}\n`,
    );
    const again = install(m);
    expect(again.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(again.stdout).not.toContain("restart");
    expect(again.stdout).not.toContain("rm -rf");
    expect(readdirSync(openCodeHomeOf(m)).sort()).toEqual(["0.1.177", "0.1.178", "current"]);
  });

  it("leaves an older directory in place while a process runs from it, and removes it after", async () => {
    const m = updatedThrough("0.1.176", "0.1.177");
    const busy = openCodeDirOf(m, "0.1.176");
    // As a daemon spawned by the bridge runs: Node with the package's CLI as its argument.
    const daemon = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)", join(busy, "dist", "cli", "squeal.mjs"), "daemon"],
      { stdio: "ignore" },
    );
    try {
      m.publish("0.1.178");
      const r = install(m);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`Kept ${busy}: a running process uses it\n`);
      expect(readdirSync(openCodeHomeOf(m)).sort()).toEqual([
        "0.1.176",
        "0.1.177",
        "0.1.178",
        "current",
      ]);
      expect(readFileSync(ownedOf(m), "utf8")).toContain(`opencode ${busy}\n`);
    } finally {
      daemon.kill();
      await new Promise((done) => daemon.once("exit", done));
    }
    const r = install(m);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`$ rm -rf ${busy}\n`);
    expect(readdirSync(openCodeHomeOf(m)).sort()).toEqual(["0.1.177", "0.1.178", "current"]);
  });

  it("uninstalls the kept directory with the current one", () => {
    const m = updatedThrough("0.1.176", "0.1.177");
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(`$ rm -rf ${openCodeDirOf(m, "0.1.176")}\n`);
    expect(r.stdout).toContain(`$ rm -rf ${openCodeDirOf(m)}\n`);
    expect(existsSync(join(m.home, ".local", "share", "squeal"))).toBe(false);
  });

  it("updates only OpenCode with --opencode, as squeal update runs it", () => {
    const m = machine(["claude", "codex", "pi", "opencode"]);
    m.publish("0.1.176");
    const r = install(m, "--opencode");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`opencode plugin file:${openCodeLinkOf(m)} -g`]);
    expect(r.stdout).not.toContain("squeal setup");
    expect(readFileSync(ownedOf(m), "utf8")).toBe(`opencode ${openCodeDirOf(m)}\nopencode\n`);
  });

  it("stops with --opencode when opencode is not on the PATH", () => {
    const m = machine(["claude"]);
    m.publish("0.1.176");
    const r = install(m, "--opencode");
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("squeal install: opencode is not on the PATH\n");
    expect(m.calls()).toEqual([]);
  });
});
