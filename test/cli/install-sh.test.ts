import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALL_SH, type Machine, machine, snapshot } from "./install-fixture.js";

/* Spec 005 D3, `install.sh`, run as `curl … | sh` runs it: the script on stdin. */

const SCRIPT = readFileSync(INSTALL_SH, "utf8");

function install(m: Machine, ...args: string[]) {
  return m.sh(args.length === 0 ? [] : ["-s", "--", ...args], { input: SCRIPT });
}

const launcherOf = (m: Machine) => join(m.home, ".local", "bin", "squeal");

/** Runs the installed launcher as the user's terminal would. */
function squeal(m: Machine, ...args: string[]) {
  return m.sh([launcherOf(m), ...args]);
}

describe("install.sh", () => {
  it("installs the plugin in both harnesses and puts the launcher on the PATH", () => {
    const m = machine();
    m.publish("0.1.134");
    const r = install(m);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([
      `claude plugin marketplace add file://${m.hub}`,
      "claude plugin install squeal@hearsay",
      `codex plugin marketplace add file://${m.hub}`,
      "codex plugin add squeal@hearsay",
    ]);
    // Each command is printed before it runs.
    expect(r.stdout).toContain("$ claude plugin install squeal@hearsay\n");
    expect(r.stdout).toContain(`$ cp ${m.home}/`);
    expect(r.stdout).toContain(`${join(m.home, ".local", "bin")} is not on your PATH`);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("Next, in each repository: squeal setup");
    expect(readFileSync(launcherOf(m), "utf8")).toBe(
      readFileSync(join(m.hub, "plugins", "codex", "bin", "squeal-launcher"), "utf8"),
    );
    expect(JSON.parse(squeal(m, "--version").stdout)).toMatchObject({ version: "0.1.134" });
  });

  it("changes nothing on a second run", () => {
    const m = machine();
    m.publish("0.1.134");
    expect(install(m).status).toBe(0);
    const before = snapshot(m.home);
    m.clearLog();
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(snapshot(m.home)).toEqual(before);
    expect(r.stdout).toContain("Claude Code has squeal@hearsay 0.1.134; squeal update updates it");
    expect(r.stdout).toContain("Codex has squeal@hearsay 0.1.134");
    expect(r.stdout).toContain("is the launcher of squeal@hearsay 0.1.134");
  });

  it.each([["claude"], ["codex"]] as const)("installs in %s alone when it is the only harness", (h) => {
    const m = machine([h]);
    m.publish("0.1.134");
    const r = install(m);
    expect(r.status).toBe(0);
    expect(m.calls().every((c) => c.startsWith(`${h} `))).toBe(true);
    expect(m.calls()).toHaveLength(2);
    expect(JSON.parse(squeal(m).stdout)).toMatchObject({
      harness: h === "claude" ? "claude-code" : "codex",
    });
  });

  it("uses SQUEAL_BIN_DIR, and says nothing about the PATH when it is on it", () => {
    const m = machine();
    m.publish("0.1.134");
    const bin = join(m.root, "my-bin");
    m.env.SQUEAL_BIN_DIR = bin;
    m.env.PATH = `${m.env.PATH}:${bin}`;
    const r = install(m);
    expect(r.status).toBe(0);
    expect(existsSync(join(bin, "squeal"))).toBe(true);
    expect(existsSync(launcherOf(m))).toBe(false);
    expect(r.stdout).not.toContain("not on your PATH");
  });

  it("--uninstall removes the launcher and the plugin from each harness", () => {
    const m = machine();
    m.publish("0.1.134");
    const empty = snapshot(m.home);
    expect(install(m).status).toBe(0);
    m.clearLog();
    const r = install(m, "--uninstall");
    expect(r.status).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin uninstall squeal@hearsay",
      "codex plugin remove squeal@hearsay",
    ]);
    expect(existsSync(launcherOf(m))).toBe(false);
    // What stays is the marketplace each harness added, which the script says how to remove.
    expect(Object.keys(snapshot(m.home)).filter((f) => !(f in empty)).sort()).toEqual([
      ".claude/plugins/installed_plugins.json",
      ".claude/plugins/known_marketplaces.json",
      ".codex/stub-marketplaces.json",
    ]);
    expect(JSON.parse(snapshot(m.home)[".claude/plugins/installed_plugins.json"]?.slice(4) ?? "")).toEqual({
      version: 2,
      plugins: {},
    });
    expect(r.stdout).toContain("claude plugin marketplace remove hearsay");
    // A second uninstall finds nothing; an install afterwards works with the marketplace still added.
    m.clearLog();
    expect(install(m, "--uninstall").status).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(install(m).status).toBe(0);
    expect(JSON.parse(squeal(m).stdout)).toMatchObject({ version: "0.1.134" });
  });

  it("stops before any harness command when neither claude nor codex is on the PATH", () => {
    const m = machine([]);
    m.publish("0.1.134");
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("neither claude nor codex is on the PATH");
    expect(existsSync(launcherOf(m))).toBe(false);
  });

  it("says the hub is private when adding the marketplace fails, and copies no launcher", () => {
    const m = machine();
    m.publish("0.1.134");
    m.env.STUB_PRIVATE = "1";
    delete m.env.SQUEAL_MARKETPLACE;
    const r = install(m);
    expect(r.status).toBe(1);
    expect(m.calls()).toEqual([
      "claude plugin marketplace add hearsay-tools/marketplace",
      "claude plugin install squeal@hearsay",
    ]);
    expect(r.stderr).toContain("The hub is private for now");
    expect(r.stderr).toContain("needs access to github.com/hearsay-tools/marketplace");
    expect(existsSync(launcherOf(m))).toBe(false);
  });

  it("stops when Node is older than 22.13", () => {
    const m = machine();
    m.publish("0.1.134");
    const fake = join(m.root, "old-node");
    mkdirSync(fake);
    writeFileSync(join(fake, "node"), '#!/bin/sh\n[ "$1" = --version ] && echo v22.12.0\nexit 1\n');
    chmodSync(join(fake, "node"), 0o755);
    m.env.PATH = `${fake}:${m.env.PATH}`;
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Squeal needs Node 22.13 or later; this is Node v22.12.0");
    expect(m.calls()).toEqual([]);
  });

  it("leaves a squeal that is not the launcher alone", () => {
    const m = machine();
    m.publish("0.1.134");
    mkdirSync(join(m.home, ".local", "bin"), { recursive: true });
    writeFileSync(launcherOf(m), "#!/bin/sh\necho mine\n");
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("exists and is not Squeal's launcher");
    expect(readFileSync(launcherOf(m), "utf8")).toBe("#!/bin/sh\necho mine\n");
    expect(install(m, "--uninstall").stdout).toContain("is not Squeal's launcher; left as it is");
    expect(existsSync(launcherOf(m))).toBe(true);
  });

  it("rejects an unknown argument", () => {
    const m = machine();
    const r = install(m, "--yes");
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("usage: install.sh [--uninstall]\n");
    expect(m.calls()).toEqual([]);
  });

  it("runs nothing from a download cut at any line", () => {
    const m = machine();
    m.publish("0.1.134");
    const before = snapshot(m.home);
    const lines = SCRIPT.split("\n");
    for (let n = 1; n < lines.length - 1; n++) {
      const cut = `${lines.slice(0, n).join("\n")}\n`;
      if (cut === SCRIPT) continue;
      m.sh([], { input: cut });
      expect(m.calls(), `cut after line ${n}`).toEqual([]);
    }
    // A cut in the middle of the last line, too.
    m.sh([], { input: SCRIPT.slice(0, SCRIPT.lastIndexOf('"$@"') + 2) });
    expect(m.calls()).toEqual([]);
    expect(snapshot(m.home)).toEqual(before);
  });

  it("is POSIX sh with set -eu, reads no stdin, and calls main last", () => {
    expect(SCRIPT.startsWith("#!/bin/sh\n")).toBe(true);
    expect(SCRIPT).toMatch(/^set -eu$/m);
    expect(SCRIPT).not.toMatch(/\bread\b/);
    expect(SCRIPT.trimEnd().split("\n").at(-1)).toBe('main "$@"');
  });
});
