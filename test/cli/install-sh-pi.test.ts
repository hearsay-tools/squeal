import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  install,
  launcherOf,
  type Machine,
  machine,
  scriptOf,
  snapshot,
} from "./install-fixture.js";

/*
 * Spec 009 D1, `install.sh` with `pi` on the PATH: the Pi package of the
 * script's release, unpacked from the tag's source archive into
 * ${XDG_DATA_HOME:-~/.local/share}/squeal/pi/<version>, then `pi install`;
 * an update installs the new directory and removes the old; `--uninstall`
 * removes what it recorded. The stub `pi` edits Pi's settings as Pi does.
 */

const OWNED = (m: Machine) => join(m.home, ".local", "state", "squeal", "installed");
const piHome = (m: Machine) => join(m.home, ".local", "share", "squeal", "pi");
const piDir = (m: Machine, v = m.version) => join(piHome(m), v);
const piPackages = (m: Machine) =>
  (JSON.parse(readFileSync(join(m.piAgent, "settings.json"), "utf8")) as { packages: string[] })
    .packages;

function squeal(m: Machine) {
  const r = m.sh([launcherOf(m)]);
  return { ...(JSON.parse(r.stdout) as { version: string; harness: string }), stderr: r.stderr };
}

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores, past 5 s under the full suite.
describe("install.sh with Pi", { timeout: 30_000 }, () => {
  it("installs the release's Pi package with pi install and the launcher from it, with Pi alone", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi install ${piDir(m)}`]);
    expect(r.stdout).toContain(
      `$ curl -fsSL -o ${piHome(m)}/.unpack.`, // the download is printed before it runs
    );
    expect(r.stdout).toContain(`file://${m.hub}/archive/squeal--v0.1.170.tar.gz\n`);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("Next, in each repository: squeal setup");
    // The package as the archive holds it, and no download left beside it.
    expect(readdirSync(piHome(m))).toEqual(["0.1.170"]);
    expect(JSON.parse(readFileSync(join(piDir(m), "package.json"), "utf8"))).toMatchObject({
      version: "0.1.170",
    });
    // Pi's own settings, relative to its agent directory, and nothing else under ~/.pi.
    expect(piPackages(m)).toEqual(["../../.local/share/squeal/pi/0.1.170"]);
    expect(Object.keys(snapshot(join(m.home, ".pi")))).toEqual(["agent/settings.json"]);
    expect(readFileSync(OWNED(m), "utf8")).toBe(`pi ${piDir(m)}\nlauncher ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(
      readFileSync(join(piDir(m), "bin", "squeal-launcher"), "utf8"),
    );
    expect(squeal(m)).toEqual({ version: "0.1.170", harness: "pi", args: [], stderr: "" });
  });

  it("changes nothing on a second run", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    const before = snapshot(m.home);
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(`Pi has Squeal 0.1.170 from ${piDir(m)}\n`);
    expect(r.stdout).not.toContain("curl");
    expect(snapshot(m.home)).toEqual(before);
  });

  it("updates: installs the new release's directory, then removes the one it replaces", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    const old = piDir(m);
    m.publish("0.1.171");
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi install ${piDir(m)}`, `pi remove ${old}`]);
    expect(r.stdout).toContain(`$ rm -rf ${old}\n`);
    expect(readdirSync(piHome(m))).toEqual(["0.1.171"]);
    expect(piPackages(m)).toEqual(["../../.local/share/squeal/pi/0.1.171"]);
    expect(readFileSync(OWNED(m), "utf8")).toBe(`launcher ${launcherOf(m)}\npi ${piDir(m)}\n`);
    expect(squeal(m)).toMatchObject({ version: "0.1.171", stderr: "" });
  });

  it("uninstalls what it installed in Pi, and leaves Pi's settings as Pi's remove left them", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi remove ${piDir(m)}`]);
    expect(piPackages(m)).toEqual([]);
    expect(existsSync(join(m.home, ".local", "share", "squeal"))).toBe(false);
    expect(existsSync(launcherOf(m))).toBe(false);
    expect(existsSync(OWNED(m))).toBe(false);
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    expect(m.calls()).toEqual([]);
  });

  it("installs, updates and uninstalls with all three harnesses", () => {
    const m = machine(["claude", "codex", "pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    expect(m.calls()).toEqual([
      `claude plugin marketplace add file://${m.hub}`,
      "claude plugin install squeal@hearsay",
      `codex plugin marketplace add file://${m.hub}`,
      "codex plugin add squeal@hearsay",
      `pi install ${piDir(m)}`,
    ]);
    expect(readFileSync(OWNED(m), "utf8")).toBe(
      `claude\ncodex\npi ${piDir(m)}\nlauncher ${launcherOf(m)}\n`,
    );
    expect(squeal(m)).toMatchObject({ version: "0.1.170", stderr: "" });
    const old = piDir(m);
    m.publish("0.1.171");
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    // squeal update updates the plugins; the release's install.sh updates Pi.
    expect(m.calls()).toEqual([`pi install ${piDir(m)}`, `pi remove ${old}`]);
    expect(r.stdout).toContain("Claude Code has squeal@hearsay 0.1.170; squeal update updates it");
    expect(squeal(m)).toMatchObject({ version: "0.1.171" });
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin uninstall squeal@hearsay",
      "codex plugin remove squeal@hearsay",
      `pi remove ${piDir(m)}`,
    ]);
    expect(existsSync(launcherOf(m))).toBe(false);
    expect(existsSync(OWNED(m))).toBe(false);
  });

  it("unpacks into XDG_DATA_HOME when it is set", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    m.env.XDG_DATA_HOME = join(m.root, "data");
    const dir = join(m.root, "data", "squeal", "pi", "0.1.170");
    expect(install(m).status).toBe(0);
    expect(m.calls()).toEqual([`pi install ${dir}`]);
    expect(squeal(m)).toMatchObject({ harness: "pi" });
    expect(install(m, "--uninstall").status).toBe(0);
    expect(existsSync(join(m.root, "data", "squeal"))).toBe(false);
  });

  it.each([
    ["it cannot download", "downloading file:///nonexistent/squeal--v0.1.170.tar.gz failed"],
    ["without this release's package", "holds no Pi package of squeal 0.1.170 at plugins/pi"],
  ])("stops on an archive %s, and leaves nothing behind", (kind, says) => {
    const m = machine(["pi"]);
    m.publish("0.1.169");
    if (kind === "it cannot download") m.env.SQUEAL_SOURCE = "file:///nonexistent";
    // Otherwise the archive of another release under this release's name.
    else
      copyFileSync(
        join(m.hub, "archive", "squeal--v0.1.169.tar.gz"),
        join(m.hub, "archive", "squeal--v0.1.170.tar.gz"),
      );
    const r = m.sh([], { input: scriptOf("0.1.170") });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(says);
    expect(m.calls()).toEqual([]);
    expect(readdirSync(piHome(m))).toEqual([]);
    expect(existsSync(OWNED(m))).toBe(false);
  });

  it("keeps the package it unpacked when pi install fails, and installs it on the retry without a download", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    m.env.STUB_FAIL = "pi install";
    const failed = install(m);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`pi install ${piDir(m)} failed`);
    expect(readFileSync(OWNED(m), "utf8")).toBe(`pi ${piDir(m)}\n`);
    delete m.env.STUB_FAIL;
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("curl");
    expect(m.calls()).toEqual([`pi install ${piDir(m)}`]);
  });

  it("keeps a recorded package when pi is no longer on the PATH", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    m.env.PATH = m.env.PATH?.split(":").slice(1).join(":") ?? "";
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`pi is not on the PATH, so Squeal stays in Pi from ${piDir(m)}`);
    expect(readFileSync(OWNED(m), "utf8")).toBe(`pi ${piDir(m)}\n`);
    expect(existsSync(piDir(m))).toBe(true);
  });

  it("keeps a package Pi had before install.sh ran, and says how to remove it", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    // The record lost, as when the state directory was cleaned.
    m.sh(["-c", `rm "${OWNED(m)}"`]);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(
      `Pi had Squeal from ${piDir(m)} before install.sh ran, so it stays; pi remove ${piDir(m)} removes it`,
    );
    expect(existsSync(piDir(m))).toBe(true);
  });
});
