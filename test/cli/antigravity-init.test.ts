import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ANTIGRAVITY_INSTALL_COMMAND } from "../../src/cli/antigravity/install.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { cleanupFixtures, scratch } from "./setup/fixture.js";

/*
 * Spec 024 D6: `squeal init --harness antigravity` writes squeal.config.json
 * when absent and prints the install command, writing nothing under
 * `~/.gemini/config/`, which Antigravity owns (D1).
 */

afterEach(cleanupFixtures);

async function init(args: string[], cwd: string, env: Record<string, string>) {
  const out = { stdout: "", stderr: "" };
  const io: CliIo = {
    stdout: (t) => {
      out.stdout += t;
    },
    stderr: (t) => {
      out.stderr += t;
    },
    cwd,
    env,
  };
  return { code: await main(["init", ...args], io), ...out };
}

function repo(): string {
  const root = scratch("squeal-agy-init-");
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return root;
}

function home(plugin?: { version: string; config?: unknown }): string {
  const dir = scratch("squeal-agy-home-");
  if (plugin !== undefined) {
    const root = join(dir, ".gemini", "config", "plugins", "squeal");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "plugin.json"), JSON.stringify({ version: plugin.version }));
    if (plugin.config !== undefined) {
      writeFileSync(join(dir, ".gemini", "config", "config.json"), JSON.stringify(plugin.config));
    }
  }
  return dir;
}

describe("squeal init --harness antigravity (spec 024 D6)", () => {
  it("writes squeal.config.json and prints the install command, writing nothing under ~/.gemini", async () => {
    const root = repo();
    const HOME = home();
    const r = await init(["--harness", "antigravity"], root, { HOME });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "squeal.config.json"), "utf8"))).toEqual(
      DEFAULT_POLICY,
    );
    expect(r.stdout).toBe(
      [
        "squeal init: wrote squeal.config.json with every default policy key",
        "Each user installs the Antigravity plugin once; Antigravity writes its own config:",
        `  ${ANTIGRAVITY_INSTALL_COMMAND}`,
        "",
      ].join("\n"),
    );
    expect(readdirSync(HOME)).toEqual([]);
  });

  it("keeps an existing config, and names no install step when the plugin is installed", async () => {
    const root = repo();
    writeFileSync(join(root, "squeal.config.json"), "{}\n");
    const r = await init(["--harness=antigravity"], root, { HOME: home({ version: "0.1.602" }) });
    expect(r.code).toBe(0);
    expect(readFileSync(join(root, "squeal.config.json"), "utf8")).toBe("{}\n");
    expect(r.stdout).toBe("squeal init: kept squeal.config.json\n");
  });

  it("says the installed plugin is disabled, without enabling it", async () => {
    const root = repo();
    const config = { plugins: { squeal: { enabled: false } } };
    const HOME = home({ version: "0.1.602", config });
    const r = await init(["--harness", "antigravity"], root, { HOME });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "Antigravity has the plugin 0.1.602, but the Squeal plugin is disabled in ~/.gemini/config/config.json (agy plugin enable squeal enables it).\n",
    );
    const after = readFileSync(join(HOME, ".gemini", "config", "config.json"), "utf8");
    expect(JSON.parse(after)).toEqual(config);
  });

  it("refuses outside a git worktree and names antigravity among the harnesses", async () => {
    const outside = scratch("squeal-agy-outside-");
    const r = await init(["--harness", "antigravity"], outside, { HOME: home() });
    expect(r.code).toBe(1);
    expect(existsSync(join(outside, "squeal.config.json"))).toBe(false);
    const bad = await init(["--harness", "gemini"], repo(), { HOME: home() });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('unknown harness "gemini": claude-code, codex or antigravity');
    expect(bad.stderr).toContain("squeal init --harness antigravity\n");
  });
});
