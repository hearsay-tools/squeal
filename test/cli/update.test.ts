import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { INSTALL_SH, LAUNCHER, laterLauncher, type Machine, machine } from "./install-fixture.js";

/* Spec 005 D3, `squeal update`: every harness's plugin at one version, and the launcher across it. */

async function update(m: Machine, ...args: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await main(["update", ...args], {
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

const launcherOf = (m: Machine) => join(m.home, ".local", "bin", "squeal");

/** A machine set up by install.sh at `version`. */
function installed(version: string, harnesses?: readonly ("claude" | "codex")[]): Machine {
  const m = machine(harnesses);
  m.publish(version);
  const r = m.sh([], { input: readFileSync(INSTALL_SH, "utf8") });
  expect(r.status, r.stderr).toBe(0);
  m.clearLog();
  return m;
}

function squeal(m: Machine) {
  const r = m.sh([launcherOf(m)]);
  return { version: (JSON.parse(r.stdout) as { version: string }).version, stderr: r.stderr };
}

// Each test runs install.sh first, about ten processes; 8.4 s at a load of 155 on 24 cores.
describe("squeal update", { timeout: 30_000 }, () => {
  it("brings two harness versions to one, and the launcher follows without a re-copy", async () => {
    const m = installed("0.1.131");
    // Codex upgrades at a session start by itself; Claude Code stays behind.
    m.publish("0.1.132");
    expect(m.sh([], { input: "codex plugin marketplace upgrade hearsay\n" }).status).toBe(0);
    expect(squeal(m)).toEqual({
      version: "0.1.132",
      stderr:
        "squeal: Claude Code has squeal 0.1.131 and Codex has 0.1.132; running 0.1.132. Run squeal update to bring them to one version.\n",
    });
    m.publish("0.1.133");
    m.clearLog();
    const launcher = readFileSync(launcherOf(m), "utf8");
    const r = await update(m);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual([
      "claude plugin marketplace update hearsay",
      "claude plugin update squeal@hearsay",
      "codex plugin marketplace upgrade hearsay",
    ]);
    expect(r.stdout).toBe(
      [
        "$ claude plugin marketplace update hearsay",
        "$ claude plugin update squeal@hearsay",
        "$ codex plugin marketplace upgrade hearsay",
        "Claude Code: squeal@hearsay 0.1.133, was 0.1.131",
        "Codex: squeal@hearsay 0.1.133, was 0.1.132",
        "A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code.",
        "",
      ].join("\n"),
    );
    expect(squeal(m)).toEqual({ version: "0.1.133", stderr: "" });
    expect(readFileSync(launcherOf(m), "utf8")).toBe(launcher);
  });

  it("says up to date when nothing changed", async () => {
    const m = installed("0.1.134");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Claude Code: squeal@hearsay 0.1.134, up to date\n");
    expect(r.stdout).toContain("Codex: squeal@hearsay 0.1.134, up to date\n");
  });

  it("updates only the harnesses that have the plugin", async () => {
    const m = installed("0.1.131", ["codex"]);
    m.publish("0.1.132");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual(["codex plugin marketplace upgrade hearsay"]);
    expect(squeal(m).version).toBe("0.1.132");
    // Codex has no reload: Claude Code's is not named (lessons 008 defect 4(a)).
    expect(r.stdout).toContain(
      "A running session keeps the version it loaded until it restarts.\n",
    );
    expect(r.stdout).not.toContain("Claude Code");
  });

  it("names /reload-plugins when Claude Code alone is updated", async () => {
    const m = installed("0.1.131", ["claude"]);
    m.publish("0.1.132");
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n").slice(-3)).toEqual([
      "Claude Code: squeal@hearsay 0.1.132, was 0.1.131",
      "A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code.",
      "",
    ]);
  });

  it("re-copies the launcher when the plugin's copy has a newer format", async () => {
    const m = installed("0.1.131");
    m.publish("0.1.132", laterLauncher(7));
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Copied the launcher (format 6, now 7) to ${launcherOf(m)}\n`);
    expect(readFileSync(launcherOf(m), "utf8")).toBe(laterLauncher(7));
    expect(squeal(m)).toEqual({ version: "0.1.132", stderr: "" });
  });

  it("leaves a launcher it did not copy, and creates none", async () => {
    const m = installed("0.1.131");
    writeFileSync(launcherOf(m), "#!/bin/sh\necho mine\n");
    m.publish("0.1.132", laterLauncher(7));
    expect((await update(m)).stdout).not.toContain("Copied");
    expect(readFileSync(launcherOf(m), "utf8")).toBe("#!/bin/sh\necho mine\n");
    const bare = installed("0.1.131");
    bare.env.SQUEAL_BIN_DIR = join(bare.root, "elsewhere");
    bare.publish("0.1.132", laterLauncher(7));
    expect((await update(bare)).stdout).not.toContain("Copied");
  });

  it("exits 1 naming the command that failed, and still updates the other harness", async () => {
    const m = installed("0.1.131");
    m.publish("0.1.132");
    m.env.STUB_FAIL = "claude plugin update";
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("squeal update: claude plugin update squeal@hearsay exited 1\n");
    expect(m.calls().at(-1)).toBe("codex plugin marketplace upgrade hearsay");
    expect(r.stdout).toContain("Claude Code: squeal@hearsay 0.1.131, not updated\n");
    expect(r.stdout).toContain("Codex: squeal@hearsay 0.1.132, was 0.1.131\n");
    expect(r.stdout).toContain("The harnesses still hold different versions");
    expect(r.stdout).not.toContain("A running session keeps");
  });

  it("prints the install commands and exits 1 when no harness has the plugin", async () => {
    const m = machine();
    mkdirSync(join(m.claudeConfig, "plugins"), { recursive: true });
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(m.calls()).toEqual([]);
    expect(r.stderr).toContain("no harness on the PATH has squeal@hearsay installed");
    expect(r.stderr).toContain("  claude plugin install squeal@hearsay\n");
    expect(r.stderr).toContain("  codex plugin add squeal@hearsay\n");
  });

  it("is a usage error with arguments", async () => {
    const r = await update(machine(), "--all");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("usage: squeal update\n");
  });

  it("keeps the fixture's launcher the shipped one", () => {
    expect(laterLauncher(6)).toBe(readFileSync(LAUNCHER, "utf8"));
  });
});
