import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  install,
  launcherOf,
  type Machine,
  machine,
  openCodeConfigOf,
  openCodeDirOf,
  openCodeHomeOf,
  openCodeLinkOf,
  openCodePluginsOf,
  ownedOf,
  piDirOf,
  scriptOf,
  snapshot,
} from "./install-fixture.js";

/*
 * Spec 008 D1, `install.sh` with `opencode` on the PATH: the OpenCode package
 * of the script's release, unpacked from the tag's source archive into
 * ${XDG_DATA_HOME:-~/.local/share}/squeal/opencode/<version>, `current`
 * pointed at it, and `opencode plugin file:<...>/current -g` run once, which
 * writes OpenCode's global config itself (updates:
 * install-sh-opencode-update.test.ts). The stub `opencode` writes the config
 * as OpenCode 1.18.35 does.
 */

function squeal(m: Machine) {
  const r = m.sh([launcherOf(m)]);
  return { ...(JSON.parse(r.stdout) as { version: string; harness: string }), stderr: r.stderr };
}

const plugin = (m: Machine) => `opencode plugin file:${openCodeLinkOf(m)} -g`;

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores.
describe("install.sh with OpenCode", { timeout: 30_000 }, () => {
  it("unpacks the release's package, links current to it and installs the link with opencode plugin, with OpenCode alone", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([plugin(m)]);
    expect(r.stdout).toContain(`$ curl -fsSL -o ${openCodeHomeOf(m)}/.unpack.`);
    expect(r.stdout).toContain(`file://${m.hub}/archive/squeal--v0.1.176.tar.gz\n`);
    expect(r.stdout).toContain(`$ ln -sfn 0.1.176 ${openCodeLinkOf(m)}\n`);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("Next, in each repository: squeal setup");
    // The package as the archive holds it, the link beside it, and no download left behind.
    expect(readdirSync(openCodeHomeOf(m)).sort()).toEqual(["0.1.176", "current"]);
    expect(readlinkSync(openCodeLinkOf(m))).toBe("0.1.176");
    expect(JSON.parse(readFileSync(join(openCodeLinkOf(m), "package.json"), "utf8"))).toMatchObject(
      { name: "squeal-opencode", version: "0.1.176" },
    );
    // OpenCode's own config, written by its own command, names the link, not the version.
    expect(openCodePluginsOf(m)).toEqual([`file:${openCodeLinkOf(m)}`]);
    expect(Object.keys(snapshot(join(m.home, ".config")))).toEqual(["opencode/opencode.json"]);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(
      `opencode ${openCodeDirOf(m)}\nopencode\nlauncher ${launcherOf(m)}\n`,
    );
    expect(readFileSync(launcherOf(m), "utf8")).toBe(
      readFileSync(join(openCodeDirOf(m), "bin", "squeal-launcher"), "utf8"),
    );
    expect(squeal(m)).toEqual({ version: "0.1.176", harness: "opencode", args: [], stderr: "" });
  });

  it("changes nothing on a second run of the same version", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    expect(install(m).status).toBe(0);
    const before = snapshot(m.home);
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(`OpenCode has Squeal 0.1.176 from ${openCodeDirOf(m)}\n`);
    expect(r.stdout).not.toContain("curl");
    expect(r.stdout).not.toContain("ln -sfn");
    expect(snapshot(m.home)).toEqual(before);
  });

  it("does not run opencode plugin when the config lists the link already, in opencode.jsonc too", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    mkdirSync(openCodeConfigOf(m), { recursive: true });
    writeFileSync(
      join(openCodeConfigOf(m), "opencode.jsonc"),
      `{\n  // Squeal\n  "plugin": ["file:${openCodeLinkOf(m)}",],\n}\n`,
    );
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(readlinkSync(openCodeLinkOf(m))).toBe("0.1.176");
    // Not ours to remove at uninstall: install.sh did not add it.
    expect(readFileSync(ownedOf(m), "utf8")).toBe(
      `opencode ${openCodeDirOf(m)}\nlauncher ${launcherOf(m)}\n`,
    );
  });

  it("installs with all four harnesses, and uninstalls what it made", () => {
    const m = machine(["claude", "codex", "pi", "opencode"]);
    m.publish("0.1.176");
    expect(install(m).status).toBe(0);
    expect(m.calls()).toEqual([
      `claude plugin marketplace add file://${m.hub}`,
      "claude plugin install squeal@hearsay",
      `codex plugin marketplace add file://${m.hub}`,
      "codex plugin add squeal@hearsay",
      `pi install ${piDirOf(m)}`,
      plugin(m),
    ]);
    expect(squeal(m)).toMatchObject({ version: "0.1.176", stderr: "" });
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin uninstall squeal@hearsay",
      "codex plugin remove squeal@hearsay",
      `pi remove ${piDirOf(m)}`,
    ]);
    expect(existsSync(join(m.home, ".local", "share", "squeal"))).toBe(false);
    expect(existsSync(ownedOf(m))).toBe(false);
  });

  it("uninstalls the package and the link, and names the config entry it cannot remove", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    expect(install(m).status).toBe(0);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain(`$ rm -rf ${openCodeDirOf(m)}\n`);
    expect(r.stdout).toContain(`$ rm ${openCodeLinkOf(m)}\n`);
    expect(r.stdout).toContain(
      `OpenCode's global config in ${openCodeConfigOf(m)} still lists file:${openCodeLinkOf(m)}. ` +
        "OpenCode has no command that removes a plugin and install.sh does not edit its config, " +
        "so delete that entry yourself; until then OpenCode starts as before, without Squeal\n",
    );
    // OpenCode's config is OpenCode's: left as its own command wrote it.
    expect(openCodePluginsOf(m)).toEqual([`file:${openCodeLinkOf(m)}`]);
    expect(existsSync(join(m.home, ".local", "share", "squeal"))).toBe(false);
    expect(existsSync(launcherOf(m))).toBe(false);
    expect(existsSync(ownedOf(m))).toBe(false);
    // A second uninstall has nothing left to say, and an install after it reuses the entry.
    const again = install(m, "--uninstall");
    expect(again.status).toBe(0);
    expect(again.stdout).not.toContain("OpenCode");
    m.clearLog();
    expect(install(m).status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(squeal(m)).toMatchObject({ harness: "opencode" });
  });

  it("uninstalls without opencode on the PATH, since nothing it removes needs it", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    expect(install(m).status).toBe(0);
    m.env.PATH = m.env.PATH?.split(":").slice(1).join(":") ?? "";
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(existsSync(openCodeHomeOf(m))).toBe(false);
    expect(existsSync(ownedOf(m))).toBe(false);
  });

  it("unpacks into XDG_DATA_HOME and reads XDG_CONFIG_HOME when they are set", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    m.env.XDG_DATA_HOME = join(m.root, "data");
    m.env.XDG_CONFIG_HOME = join(m.root, "config");
    const link = join(m.root, "data", "squeal", "opencode", "current");
    expect(install(m).status).toBe(0);
    expect(m.calls()).toEqual([`opencode plugin file:${link} -g`]);
    expect(readFileSync(join(m.root, "config", "opencode", "opencode.json"), "utf8")).toContain(
      `"file:${link}"`,
    );
    m.clearLog();
    expect(install(m).status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(squeal(m)).toMatchObject({ harness: "opencode" });
    expect(install(m, "--uninstall").status).toBe(0);
    expect(existsSync(join(m.root, "data", "squeal"))).toBe(false);
  });

  it("stops on an archive without this release's package, and leaves nothing behind", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.175");
    const r = m.sh([], { input: scriptOf("0.1.176") });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("downloading");
    expect(m.calls()).toEqual([]);
    expect(readdirSync(openCodeHomeOf(m))).toEqual([]);
    expect(existsSync(ownedOf(m))).toBe(false);
  });

  it("keeps the package and the link when opencode plugin fails, and installs on the retry without a download", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    m.env.STUB_FAIL = "opencode plugin";
    const failed = install(m);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`opencode plugin file:${openCodeLinkOf(m)} -g failed`);
    expect(readFileSync(ownedOf(m), "utf8")).toBe(`opencode ${openCodeDirOf(m)}\n`);
    delete m.env.STUB_FAIL;
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("curl");
    expect(m.calls()).toEqual([plugin(m)]);
  });

  it("stops when current is not a link, before running opencode", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    mkdirSync(openCodeLinkOf(m), { recursive: true });
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${openCodeLinkOf(m)} exists and is not a link`);
    expect(m.calls()).toEqual([]);
  });

  it("keeps a package OpenCode had before install.sh ran, and says so", () => {
    const m = machine(["opencode"]);
    m.publish("0.1.176");
    expect(install(m).status).toBe(0);
    // The record lost, as when the state directory was cleaned.
    m.sh(["-c", `rm "${ownedOf(m)}"`]);
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `OpenCode had Squeal from ${openCodeDirOf(m)} before install.sh ran, so it stays`,
    );
    expect(existsSync(openCodeDirOf(m))).toBe(true);
    expect(readlinkSync(openCodeLinkOf(m))).toBe("0.1.176");
  });
});
