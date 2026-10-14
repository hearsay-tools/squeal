import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
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
  scriptOf,
  snapshot,
} from "./install-fixture.js";

/*
 * Spec 009 D1, `install.sh` with `pi` on the PATH: the Pi package of the
 * script's release, unpacked from the tag's source archive into
 * ${XDG_DATA_HOME:-~/.local/share}/squeal/pi/<version>, then `pi install`;
 * `--uninstall` removes what it recorded (updates: install-sh-pi-update.test.ts).
 * The stub `pi` edits Pi's settings as Pi does.
 */

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
    expect(m.calls()).toEqual([`pi install ${piDirOf(m)}`]);
    expect(r.stdout).toContain(
      `$ curl -fsSL -o ${piHomeOf(m)}/.unpack.`, // the download is printed before it runs
    );
    expect(r.stdout).toContain(`file://${m.hub}/archive/squeal--v0.1.170.tar.gz\n`);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("Next, in each repository: squeal setup");
    // The package as the archive holds it, and no download left beside it.
    expect(readdirSync(piHomeOf(m))).toEqual(["0.1.170"]);
    expect(JSON.parse(readFileSync(join(piDirOf(m), "package.json"), "utf8"))).toMatchObject({
      version: "0.1.170",
    });
    // Pi's own settings, relative to its agent directory, and nothing else under ~/.pi.
    expect(piPackagesOf(m)).toEqual(["../../.local/share/squeal/pi/0.1.170"]);
    expect(Object.keys(snapshot(join(m.home, ".pi")))).toEqual(["agent/settings.json"]);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(`pi ${piDirOf(m)}\nlauncher ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(
      readFileSync(join(piDirOf(m), "bin", "squeal-launcher"), "utf8"),
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
    expect(r.stdout).toContain(`Pi has Squeal 0.1.170 from ${piDirOf(m)}\n`);
    expect(r.stdout).not.toContain("curl");
    expect(snapshot(m.home)).toEqual(before);
  });

  it("uninstalls what it installed in Pi, and leaves Pi's settings as Pi's remove left them", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([`pi remove ${piDirOf(m)}`]);
    expect(piPackagesOf(m)).toEqual([]);
    expect(existsSync(join(m.home, ".local", "share", "squeal"))).toBe(false);
    expect(existsSync(launcherOf(m))).toBe(false);
    expect(existsSync(ownedOf(m))).toBe(false);
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
      `pi install ${piDirOf(m)}`,
    ]);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(
      `claude\ncodex\npi ${piDirOf(m)}\nlauncher ${launcherOf(m)}\n`,
    );
    expect(squeal(m)).toMatchObject({ version: "0.1.170", stderr: "" });
    const old = piDirOf(m);
    m.publish("0.1.171");
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    // squeal update updates the plugins; the release's install.sh updates Pi.
    expect(m.calls()).toEqual([`pi install ${piDirOf(m)}`, `pi remove ${old}`]);
    expect(r.stdout).toContain("Claude Code has squeal@hearsay 0.1.170; squeal update updates it");
    expect(squeal(m)).toMatchObject({ version: "0.1.171" });
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    // The kept directory is no longer in Pi's settings, so it is only deleted.
    expect(m.calls()).toEqual([
      "claude plugin uninstall squeal@hearsay",
      "codex plugin remove squeal@hearsay",
      `pi remove ${piDirOf(m)}`,
    ]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(launcherOf(m))).toBe(false);
    expect(existsSync(ownedOf(m))).toBe(false);
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
    expect(readdirSync(piHomeOf(m))).toEqual([]);
    expect(existsSync(ownedOf(m))).toBe(false);
  });

  it("keeps the package it unpacked when pi install fails, and installs it on the retry without a download", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    m.env.STUB_FAIL = "pi install";
    const failed = install(m);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`pi install ${piDirOf(m)} failed`);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(`pi ${piDirOf(m)}\n`);
    delete m.env.STUB_FAIL;
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("curl");
    expect(m.calls()).toEqual([`pi install ${piDirOf(m)}`]);
  });

  it("keeps a recorded package when pi is no longer on the PATH", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    m.env.PATH = m.env.PATH?.split(":").slice(1).join(":") ?? "";
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`pi is not on the PATH, so Squeal stays in Pi from ${piDirOf(m)}`);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(`pi ${piDirOf(m)}\n`);
    expect(existsSync(piDirOf(m))).toBe(true);
  });

  it("keeps a package Pi had before install.sh ran, and says how to remove it", () => {
    const m = machine(["pi"]);
    m.publish("0.1.170");
    expect(install(m).status).toBe(0);
    // The record lost, as when the state directory was cleaned.
    m.sh(["-c", `rm "${ownedOf(m)}"`]);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(
      `Pi had Squeal from ${piDirOf(m)} before install.sh ran, so it stays; pi remove ${piDirOf(m)} removes it`,
    );
    expect(existsSync(piDirOf(m))).toBe(true);
  });
});
