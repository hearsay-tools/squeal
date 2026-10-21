import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFloor } from "../../src/harness/build.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import {
  INSTALL_SH,
  install,
  launcherOf,
  type Machine,
  machine,
  snapshot,
} from "./install-fixture.js";

/* Spec 005 D3, `install.sh`, run as `curl … | sh` runs it: the script on stdin. */

const SCRIPT = readFileSync(INSTALL_SH, "utf8");
const LAST = SCRIPT.slice(SCRIPT.trimEnd().lastIndexOf("\n") + 1);

const [MAJOR = 0, MINOR = 0] = nodeFloor().split(".").map(Number);

/** A `node` first on `m`'s PATH that says it is `version` and runs this Node for the rest. */
function nodeSaying(m: Machine, version: string): void {
  const dir = join(m.root, "node-says");
  mkdirSync(dir);
  writeFileSync(
    join(dir, "node"),
    `#!/bin/sh\n[ "$1" = --version ] && { echo v${version}; exit 0; }\nexec "${process.execPath}" "$@"\n`,
  );
  chmodSync(join(dir, "node"), 0o755);
  m.env.PATH = `${dir}:${m.env.PATH}`;
}

/** Runs the installed launcher as the user's terminal would. */
function squeal(m: Machine, ...args: string[]) {
  return m.sh([launcherOf(m), ...args]);
}

// Each installer run spawns about ten processes; 1.9 s alone at a load of 77 on 24 cores, past 5 s under the full suite.
describe("install.sh", { timeout: 30_000 }, () => {
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

  it.each([["claude"], ["codex"]] as const)(
    "installs in %s alone when it is the only harness",
    (h) => {
      const m = machine([h]);
      m.publish("0.1.134");
      const r = install(m);
      expect(r.status).toBe(0);
      expect(m.calls().every((c) => c.startsWith(`${h} `))).toBe(true);
      expect(m.calls()).toHaveLength(2);
      expect(JSON.parse(squeal(m).stdout)).toMatchObject({
        harness: h === "claude" ? "claude-code" : "codex",
      });
    },
  );

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

  it("stops before any harness command when none of claude, codex, pi and opencode is on the PATH", () => {
    const m = machine([]);
    m.publish("0.1.134");
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "none of claude, codex, pi and opencode is on the PATH: install Claude Code, Codex, Pi or OpenCode first",
    );
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

  it("stops when Node is older than the floor, engines.node (011-86)", () => {
    const m = machine();
    m.publish("0.1.134");
    const below = MINOR > 0 ? `${MAJOR}.${MINOR - 1}.99` : `${MAJOR - 1}.99.99`;
    nodeSaying(m, below);
    const r = install(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`Squeal needs Node ${nodeFloor()} or later; this is Node v${below}`);
    expect(m.calls()).toEqual([]);
  });

  it("installs on the floor itself, and on the next major's first release", () => {
    for (const version of [`${nodeFloor()}.0`, `${MAJOR + 1}.0.0`]) {
      const m = machine();
      m.publish("0.1.134");
      nodeSaying(m, version);
      const r = install(m);
      expect(r.stderr, version).toBe("");
      expect(r.status, version).toBe(0);
    }
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
    expect(r.stderr).toBe("usage: install.sh [--uninstall | --pi | --opencode]\n");
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
    expect(snapshot(m.home)).toEqual(before);
  });

  it.each([[[]], [["--uninstall"]]] as const)(
    "runs nothing from a download cut at any byte of its last line, with arguments %j",
    (args) => {
      const m = machine();
      m.publish("0.1.134");
      // Installed first, so a cut uninstall has something it could remove.
      if (args.length > 0) expect(install(m).status).toBe(0);
      m.clearLog();
      const before = snapshot(m.home);
      const head = SCRIPT.slice(0, SCRIPT.length - LAST.length);
      // Every proper prefix: `main`, `main ` and `main "$@"` among them.
      for (let n = 0; n < LAST.trimEnd().length; n++) {
        const cut = LAST.slice(0, n);
        const r = m.sh(args.length === 0 ? [] : ["-s", "--", ...args], { input: head + cut });
        expect(m.calls(), `cut ${JSON.stringify(cut)}`).toEqual([]);
        // The cuts that parse call main without its completion argument.
        if (/^main( "\$@")? ?$/.test(cut)) {
          expect(r.status, `cut ${JSON.stringify(cut)}`).toBe(1);
          expect(r.stderr).toContain("ends early, as a cut download does, so it ran nothing");
        }
      }
      expect(snapshot(m.home)).toEqual(before);
    },
  );

  it("names the release it belongs to, the root package's version", () => {
    const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    // Raised with the root version at each bump, so a release's script fetches its own tag.
    expect(/^SQUEAL_VERSION=(.*)$/m.exec(SCRIPT)?.[1]).toBe(version);
  });

  it("is POSIX sh with set -eu, reads no stdin, and calls main last with its completion argument", () => {
    expect(SCRIPT.startsWith("#!/bin/sh\n")).toBe(true);
    expect(SCRIPT).toMatch(/^set -eu$/m);
    expect(SCRIPT).not.toMatch(/\bread\b/);
    expect(LAST).toBe('main "$@" squeal-install-complete\n');
  });
});
