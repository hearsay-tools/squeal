import { mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import {
  type Harness,
  install,
  LAUNCHER,
  laterLauncher,
  launcherOf,
  type Machine,
  machine,
  openCodeConfigOf,
  openCodeDirOf,
  openCodeHomeOf,
  openCodeLinkOf,
  piDirOf,
  writePlugin,
} from "./install-fixture.js";

/** The launcher 0.1.177 shipped: format 3, its search without OpenCode's package. */
const RELEASED_0_1_177 = readFileSync(
  join(REPO_ROOT, "test/fixtures/opencode/launcher-0.1.177"),
  "utf8",
);

/*
 * Spec 008 D1 with 005 D3, `squeal update` in OpenCode: when OpenCode's
 * global config lists install.sh's `current` link, it runs the latest
 * release's `install.sh --opencode`, which unpacks that release and repoints
 * the link, keeping the previous directory for open sessions.
 */

async function update(m: Machine) {
  let stdout = "";
  let stderr = "";
  const code = await main(["update"], {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd: m.home,
    env: m.env,
  });
  return { code, stdout, stderr };
}

/** A machine set up by install.sh at `version`, with `harnesses` on the PATH. */
function installed(version: string, harnesses: readonly Harness[] = ["opencode"]): Machine {
  const m = machine(harnesses);
  m.publish(version);
  const r = install(m);
  expect(r.status, r.stderr).toBe(0);
  m.clearLog();
  return m;
}

const squealVersion = (m: Machine) =>
  (JSON.parse(m.sh([launcherOf(m)]).stdout) as { version: string }).version;

// Each test runs install.sh at least twice, about ten processes each.
describe("squeal update in OpenCode", { timeout: 60_000 }, () => {
  it("runs the latest install.sh --opencode, which repoints current and keeps the previous directory", async () => {
    const m = installed("0.1.176");
    m.publish("0.1.177");
    const r = await update(m);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toMatch(
      new RegExp(
        `^\\$ curl -fsSL -o (\\S+)/install\\.sh ${m.env.SQUEAL_INSTALL_SH}\n\\$ sh \\1/install\\.sh --opencode\n`,
      ),
    );
    expect(r.stdout).toContain(`$ ln -sfn 0.1.177 ${openCodeLinkOf(m)}\n`);
    expect(r.stdout).toContain("OpenCode sessions already open keep the Squeal they loaded");
    // Lessons defect 4(a): no reload command of a harness that was not updated.
    expect(r.stdout.split("\n").slice(-3)).toEqual([
      "OpenCode: Squeal 0.1.177, was 0.1.176",
      "A running session keeps the version it loaded until it restarts.",
      "",
    ]);
    expect(readlinkSync(openCodeLinkOf(m))).toBe("0.1.177");
    expect(readdirSync(openCodeHomeOf(m)).sort()).toEqual(["0.1.176", "0.1.177", "current"]);
    expect(squealVersion(m)).toBe("0.1.177");
  });

  it("updates all four harnesses to one version", async () => {
    const m = installed("0.1.176", ["claude", "codex", "pi", "opencode"]);
    m.publish("0.1.177");
    const r = await update(m);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin marketplace update hearsay",
      "claude plugin update squeal@hearsay",
      "codex plugin marketplace upgrade hearsay",
      `pi install ${piDirOf(m)}`,
      `pi remove ${piDirOf(m, "0.1.176")}`,
    ]);
    expect(r.stdout).toContain("Pi: Squeal 0.1.177, was 0.1.176\n");
    expect(r.stdout).toContain("OpenCode: Squeal 0.1.177, was 0.1.176\n");
    expect(r.stdout).toContain(
      "A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code or /reload in Pi.\n",
    );
    expect(r.stdout).not.toContain("different versions");
    expect(squealVersion(m)).toBe("0.1.177");
  });

  it("names Claude Code's reload, and no Pi's, when Claude Code and OpenCode are updated", async () => {
    const m = installed("0.1.176", ["claude", "opencode"]);
    m.publish("0.1.177");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n").slice(-4)).toEqual([
      "Claude Code: squeal@hearsay 0.1.177, was 0.1.176",
      "OpenCode: Squeal 0.1.177, was 0.1.176",
      "A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code.",
      "",
    ]);
  });

  it("says up to date and changes nothing when OpenCode has the latest", async () => {
    const m = installed("0.1.176");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain("OpenCode: Squeal 0.1.176, up to date\n");
    expect(r.stdout).not.toContain("ln -sfn");
  });

  it("finds the link in opencode.jsonc too", async () => {
    const m = installed("0.1.176");
    const config = openCodeConfigOf(m);
    const json = readFileSync(join(config, "opencode.json"), "utf8");
    writeFileSync(join(config, "opencode.jsonc"), `// moved\n${json}`);
    writeFileSync(join(config, "opencode.json"), "{}");
    m.publish("0.1.177");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("OpenCode: Squeal 0.1.177, was 0.1.176\n");
  });

  it("leaves OpenCode alone when its config does not list the link", async () => {
    const m = installed("0.1.176", ["codex", "opencode"]);
    // A user who removed the entry by hand, the package still unpacked.
    writeFileSync(join(openCodeConfigOf(m), "opencode.json"), '{"plugin": []}');
    m.publish("0.1.177");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual(["codex plugin marketplace upgrade hearsay"]);
    expect(r.stdout).not.toContain("OpenCode:");
    expect(r.stdout).not.toContain("curl");
  });

  it("leaves OpenCode alone when opencode is not on the PATH", async () => {
    const m = installed("0.1.176", ["codex", "opencode"]);
    m.sh(["-c", `rm "${m.root}/stubs/opencode"`]);
    m.publish("0.1.177");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("OpenCode:");
    expect(readlinkSync(openCodeLinkOf(m))).toBe("0.1.176");
  });

  it("exits 1 when the latest install.sh cannot be downloaded", async () => {
    const m = installed("0.1.176");
    m.publish("0.1.177");
    m.env.SQUEAL_INSTALL_SH = "file:///nonexistent/install.sh";
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("squeal update: curl -fsSL -o ");
    expect(r.stdout).toContain("OpenCode: Squeal 0.1.176, not updated\n");
    expect(readlinkSync(openCodeLinkOf(m))).toBe("0.1.176");
  });

  it("names install.sh when no harness has Squeal", async () => {
    const m = machine(["opencode"]);
    mkdirSync(openCodeDirOf(m, "0.1.176"), { recursive: true });
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("neither Pi nor OpenCode has a Squeal package");
    expect(r.stderr).toContain(
      "  curl -fsSL https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh | sh\n",
    );
  });

  it("re-copies the launcher from the OpenCode package when its copy has a newer format", async () => {
    const m = installed("0.1.176");
    m.publish("0.1.177", laterLauncher(8));
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Copied the launcher (format 7, now 8) to ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(laterLauncher(8));
  });

  it("re-copies the launcher 0.1.177 installed, format 3, which never finds OpenCode's package (review 008-16 S3)", async () => {
    const m = machine(["opencode"]);
    m.publish("0.1.177", RELEASED_0_1_177);
    expect(install(m).status).toBe(0);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(RELEASED_0_1_177);
    // An older Pi package left on disk: all the format-3 launcher can find.
    writePlugin(piDirOf(m, "0.1.175"), "pi", "0.1.175");
    m.publish("0.1.178");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("OpenCode: Squeal 0.1.178, was 0.1.177\n");
    expect(r.stdout).toContain(`Copied the launcher (format 3, now 7) to ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(readFileSync(LAUNCHER, "utf8"));
    expect(squealVersion(m)).toBe("0.1.178");
  });
});
