import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import {
  install,
  LAUNCHER,
  laterLauncher,
  launcherOf,
  type Machine,
  machine,
  piDirOf,
  piHomeOf,
  piPackagesOf,
} from "./install-fixture.js";

/*
 * Spec 009 D1 with 005 D3, `squeal update` in Pi: Pi has no update for a
 * local package, so it runs the latest release's `install.sh --pi`, which
 * installs that release and keeps the previous directory for open sessions.
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
function installed(
  version: string,
  harnesses: readonly ("claude" | "codex" | "pi")[] = ["pi"],
): Machine {
  const m = machine(harnesses);
  m.publish(version);
  const r = install(m);
  expect(r.status, r.stderr).toBe(0);
  m.clearLog();
  return m;
}

const squealVersion = (m: Machine) =>
  (JSON.parse(m.sh([launcherOf(m)]).stdout) as { version: string }).version;

const LATEST = (m: Machine) => m.env.SQUEAL_INSTALL_SH;

/** The launcher release 0.1.172 shipped, before `squeal update` reached Pi (review 009-22 N1). */
const RELEASED_0_1_172 = readFileSync(join(REPO_ROOT, "test/fixtures/pi/launcher-0.1.172"), "utf8");

// Each test runs install.sh at least twice, about ten processes each.
describe("squeal update in Pi", { timeout: 60_000 }, () => {
  it("installs the latest release in Pi alone and keeps the previous directory", async () => {
    const m = installed("0.1.170");
    const old = piDirOf(m);
    m.publish("0.1.171");
    const r = await update(m);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual([`pi install ${piDirOf(m)}`, `pi remove ${old}`]);
    expect(r.stdout).toMatch(
      new RegExp(
        `^\\$ curl -fsSL -o (\\S+)/install\\.sh ${LATEST(m)}\n\\$ sh \\1/install\\.sh --pi\n`,
      ),
    );
    expect(r.stdout).toContain(
      "Pi sessions already open keep the Squeal they loaded; /reload in each loads 0.1.171. " +
        "Reload them before the next update: it removes the version they loaded unless its daemon is running\n",
    );
    expect(r.stdout.split("\n").slice(-3)).toEqual([
      "Pi: Squeal 0.1.171, was 0.1.170",
      "A running session keeps the version it loaded until it restarts, or until /reload in Pi.",
      "",
    ]);
    expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.170", "0.1.171"]);
    expect(piPackagesOf(m)).toEqual(["../../.local/share/squeal/pi/0.1.171"]);
    expect(squealVersion(m)).toBe("0.1.171");
    // The downloaded script is not left behind.
    const tmp = /-o (\S+)\/install\.sh/.exec(r.stdout)?.[1] ?? "";
    expect(tmp).not.toBe("");
    expect(existsSync(tmp)).toBe(false);
  });

  it("updates all three harnesses to one version", async () => {
    const m = installed("0.1.170", ["claude", "codex", "pi"]);
    m.publish("0.1.171");
    const r = await update(m);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin marketplace update hearsay",
      "claude plugin update squeal@hearsay",
      "codex plugin marketplace upgrade hearsay",
      `pi install ${piDirOf(m)}`,
      `pi remove ${piDirOf(m, "0.1.170")}`,
    ]);
    expect(r.stdout).toContain("Claude Code: squeal@hearsay 0.1.171, was 0.1.170\n");
    expect(r.stdout).toContain("Codex: squeal@hearsay 0.1.171, was 0.1.170\n");
    expect(r.stdout).toContain("Pi: Squeal 0.1.171, was 0.1.170\n");
    expect(r.stdout).toContain(
      "A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code or /reload in Pi.\n",
    );
    expect(r.stdout).not.toContain("different versions");
    expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.170", "0.1.171"]);
    expect(squealVersion(m)).toBe("0.1.171");
  });

  it("keeps one previous directory over two updates", async () => {
    const m = installed("0.1.170");
    m.publish("0.1.171");
    expect((await update(m)).code).toBe(0);
    m.publish("0.1.172");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`$ rm -rf ${piDirOf(m, "0.1.170")}\n`);
    expect(readdirSync(piHomeOf(m)).sort()).toEqual(["0.1.171", "0.1.172"]);
  });

  it("says up to date and installs nothing when Pi has the latest", async () => {
    const m = installed("0.1.170");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual([]);
    expect(r.stdout).toContain("Pi: Squeal 0.1.170, up to date\n");
  });

  it("exits 1 when the latest install.sh cannot be downloaded, and still updates the plugins", async () => {
    const m = installed("0.1.170", ["codex", "pi"]);
    m.publish("0.1.171");
    m.env.SQUEAL_INSTALL_SH = "file:///nonexistent/install.sh";
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("squeal update: curl -fsSL -o ");
    expect(m.calls()).toEqual(["codex plugin marketplace upgrade hearsay"]);
    expect(r.stdout).toContain("Codex: squeal@hearsay 0.1.171, was 0.1.170\n");
    expect(r.stdout).toContain("Pi: Squeal 0.1.170, not updated\n");
    expect(r.stdout).toContain("The harnesses still hold different versions");
  });

  it("leaves Pi alone when Pi has no Squeal package", async () => {
    const m = installed("0.1.170", ["codex"]);
    // pi on the PATH, after Squeal was installed without it.
    m.sh(["-c", `cp "${m.root}/stub.js" "${m.root}/stubs/pi"`]);
    m.publish("0.1.171");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual(["codex plugin marketplace upgrade hearsay"]);
    expect(r.stdout).not.toContain("Pi:");
    expect(r.stdout).not.toContain("curl");
  });

  it("names install.sh for Pi when no harness has Squeal", async () => {
    const m = machine(["pi"]);
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(m.calls()).toEqual([]);
    expect(r.stderr).toContain(
      "  curl -fsSL https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh | sh\n",
    );
  });

  it("re-copies the launcher 0.1.172 installed, format 2, which still names install.sh for Pi", async () => {
    const m = machine(["pi"]);
    m.publish("0.1.172", RELEASED_0_1_172);
    expect(install(m).status).toBe(0);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(RELEASED_0_1_172);
    m.publish("0.1.173");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Copied the launcher (format 2, now 6) to ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(readFileSync(LAUNCHER, "utf8"));
    expect(readFileSync(launcherOf(m), "utf8")).not.toContain("install.sh for Pi");
    expect(squealVersion(m)).toBe("0.1.173");
  });

  it("re-copies the launcher from the Pi package when its copy has a newer format", async () => {
    const m = installed("0.1.170");
    m.publish("0.1.171", laterLauncher(7));
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Copied the launcher (format 6, now 7) to ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(laterLauncher(7));
  });
});
