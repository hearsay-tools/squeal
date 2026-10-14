import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  install,
  launcherOf,
  type Machine,
  machine,
  ownedOf,
  piDirOf,
  piHomeOf,
  piPackagesOf,
} from "./install-fixture.js";

/*
 * Spec 009 D1, an update of Squeal in Pi by a later release's `install.sh`:
 * the new directory is installed and every older one leaves Pi's settings, but
 * the one before it stays on disk, as does an older one a running process
 * names, so a Pi session open across the update keeps working until `/reload`.
 */

const squealVersion = (m: Machine) =>
  (JSON.parse(m.sh([launcherOf(m)]).stdout) as { version: string }).version;

/** A machine with Pi alone, where install.sh installed each release in turn. */
function updatedThrough(...versions: string[]): Machine {
  const m = machine(["pi"]);
  for (const v of versions) {
    m.publish(v);
    const r = install(m);
    expect(r.status, r.stderr).toBe(0);
  }
  m.clearLog();
  return m;
}

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores.
describe("install.sh updating Squeal in Pi", { timeout: 60_000 }, () => {
  it("installs the new directory, removes the old one from Pi and keeps its files", () => {
    const m = updatedThrough("0.1.170");
    const old = piDirOf(m);
    m.publish("0.1.171");
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi install ${piDirOf(m)}`, `pi remove ${old}`]);
    expect(r.stdout).not.toContain("rm -rf");
    expect(r.stdout).toContain(
      "Pi sessions already open keep the Squeal they loaded; /reload in each loads 0.1.171\n",
    );
    expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.170", "0.1.171"]);
    expect(piPackagesOf(m)).toEqual(["../../.local/share/squeal/pi/0.1.171"]);
    // An open session's worker and its primer's CLI are still there.
    expect(readFileSync(join(old, "dist", "cli", "squeal.mjs"), "utf8")).toContain("0.1.170");
    expect(readFileSync(ownedOf(m), "utf8")).toBe(
      `pi ${old}\nlauncher ${launcherOf(m)}\npi ${piDirOf(m)}\n`,
    );
    expect(squealVersion(m)).toBe("0.1.171");
  });

  it("keeps exactly one previous directory over several updates, and a second run changes nothing", () => {
    const m = updatedThrough("0.1.170", "0.1.171");
    m.publish("0.1.172");
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi install ${piDirOf(m)}`, `pi remove ${piDirOf(m, "0.1.171")}`]);
    expect(r.stdout).toContain(`$ rm -rf ${piDirOf(m, "0.1.170")}\n`);
    expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.171", "0.1.172"]);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(
      `launcher ${launcherOf(m)}\npi ${piDirOf(m, "0.1.171")}\npi ${piDirOf(m)}\n`,
    );
    m.clearLog();
    const again = install(m);
    expect(again.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(again.stdout).not.toContain("/reload");
    expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.171", "0.1.172"]);
  });

  it("leaves an older directory in place while a process runs from it, and removes it after", async () => {
    const m = updatedThrough("0.1.170", "0.1.171");
    const busy = piDirOf(m, "0.1.170");
    // As a daemon spawned from the package runs: Node with the package's CLI as its argument.
    const daemon = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)", join(busy, "dist", "cli", "squeal.mjs"), "daemon"],
      { stdio: "ignore" },
    );
    try {
      m.publish("0.1.172");
      const r = install(m);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`Kept ${busy}: a running process uses it\n`);
      expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.170", "0.1.171", "0.1.172"]);
      expect(readFileSync(ownedOf(m), "utf8")).toContain(`pi ${busy}\n`);
    } finally {
      daemon.kill();
      await new Promise((done) => daemon.once("exit", done));
    }
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(`$ rm -rf ${busy}\n`);
    expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.171", "0.1.172"]);
  });

  it("uninstalls the kept directory with the current one", () => {
    const m = updatedThrough("0.1.170", "0.1.171");
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi remove ${piDirOf(m)}`]);
    expect(r.stdout).toContain(`$ rm -rf ${piDirOf(m, "0.1.170")}\n`);
    expect(piPackagesOf(m)).toEqual([]);
    expect(existsSync(join(m.home, ".local", "share", "squeal"))).toBe(false);
  });

  it("updates only Pi with --pi, as squeal update runs it", () => {
    const m = machine(["claude", "codex", "pi"]);
    m.publish("0.1.170");
    const r = install(m, "--pi");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi install ${piDirOf(m)}`]);
    expect(r.stdout).not.toContain("squeal setup");
    expect(readFileSync(ownedOf(m), "utf8")).toBe(`pi ${piDirOf(m)}\n`);
  });

  it("stops with --pi when pi is not on the PATH", () => {
    const m = machine(["claude"]);
    m.publish("0.1.170");
    const r = install(m, "--pi");
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("squeal install: pi is not on the PATH\n");
    expect(m.calls()).toEqual([]);
  });
});
