import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ANTIGRAVITY_INSTALL_COMMAND } from "../../../src/cli/antigravity/install.js";
import { main } from "../../../src/cli/main.js";
import type { SetupPlan } from "../../../src/cli/setup/plan.js";
import { initRepo } from "../../hash/git-repo.js";
import { capture, cleanupFixtures, harnessEnv, json, scratch, squealShaped } from "./fixture.js";

/*
 * Spec 024 D6: `squeal setup` lists Antigravity when its CLI passes
 * detection or its plugin is installed, notes a plugin its config.json
 * disables, gives it the `AGENTS.md` block, and takes `--harness antigravity`.
 * Without either, the plan is the one before Antigravity.
 */

afterEach(cleanupFixtures);

/** `squealShaped` with an `AGENTS.md` of its own, not the symlink to `CLAUDE.md`. */
const withAgents = () => squealShaped({ "AGENTS.md": "# Agents\n" });

/** A minimal tracked git repo with neither `squeal.config.json` nor instruction files. */
function bareRepo(): string {
  const root = scratch("squeal-agy-bare-");
  initRepo(root, {
    "package.json": json({ name: "demo", devDependencies: { vitest: "^3.0.0" } }),
  });
  return root;
}

/** The Antigravity CLI as `agy`: a bare semver, and `help plugin` listing uninstall and validate. */
const AGY = `#!/bin/sh
case "$1" in
  --version) echo 1.5.14 ;;
  help) printf 'Usage of agy plugin:\\n  install <dir>\\n  uninstall <name>\\n  validate <dir>\\n' ;;
  *) exit 1 ;;
esac
`;

/** `harnessEnv` with `agy` on the PATH and, when `version` is given, the plugin installed. */
function agyEnv(options: { cli?: boolean; version?: string; config?: unknown } = {}) {
  const env = harnessEnv();
  const home = env.HOME as string;
  if (options.cli !== false) {
    writeFileSync(join(home, "bin", "agy"), AGY);
    chmodSync(join(home, "bin", "agy"), 0o755);
  }
  if (options.version !== undefined) {
    const plugin = join(home, ".gemini", "config", "plugins", "squeal");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ version: options.version }));
  }
  if (options.config !== undefined) {
    writeFileSync(join(home, ".gemini", "config", "config.json"), JSON.stringify(options.config));
  }
  return env;
}

async function plan(root: string, env: Record<string, string>): Promise<SetupPlan> {
  const { io, out } = capture(root, env);
  expect(await main(["setup", "--plan", "--json"], io)).toBe(0);
  return JSON.parse(out.stdout) as SetupPlan;
}

async function planText(root: string, env: Record<string, string>): Promise<string> {
  const { io, out } = capture(root, env);
  expect(await main(["setup", "--plan"], io)).toBe(0);
  return out.stdout;
}

describe("squeal setup with Antigravity (spec 024 D6)", () => {
  it("lists no Antigravity, and keeps AGENTS.md to Codex, when neither its CLI nor its plugin is found", async () => {
    const root = withAgents();
    const facts = await plan(root, harnessEnv());
    expect(facts.harnesses.map((h) => h.id)).toEqual(["claude-code", "codex"]);
    expect(facts.instructions.find((f) => f.path === "AGENTS.md")?.harnesses).toEqual(["codex"]);
  });

  it("finds agy on the PATH, names the install command, and has it read AGENTS.md", async () => {
    const root = withAgents();
    const env = agyEnv();
    const facts = await plan(root, env);
    expect(facts.harnesses.at(-1)).toEqual({
      id: "antigravity",
      onPath: true,
      plugin: null,
      installCommands: [ANTIGRAVITY_INSTALL_COMMAND],
    });
    expect(facts.instructions.find((f) => f.path === "AGENTS.md")?.harnesses).toEqual([
      "codex",
      "antigravity",
    ]);
    const text = await planText(root, env);
    expect(text).toContain(
      `  antigravity: on the PATH, plugin not installed\n    install: ${ANTIGRAVITY_INSTALL_COMMAND}\n`,
    );
    expect(text).toContain("AGENTS.md: read by codex and antigravity;");
  });

  it("rejects an antigravity on the PATH that is not the CLI, such as the IDE launcher", async () => {
    const root = squealShaped();
    const env = agyEnv({ cli: false });
    const bin = join(env.HOME as string, "bin", "antigravity");
    writeFileSync(bin, '#!/bin/sh\necho "Antigravity 1.20.3 (IDE)"\n');
    chmodSync(bin, 0o755);
    expect((await plan(root, env)).harnesses.map((h) => h.id)).toEqual(["claude-code", "codex"]);
  });

  it("finds the plugin without the CLI, and notes when config.json disables it", async () => {
    const root = squealShaped();
    const config = { plugins: { squeal: { enabled: false } } };
    const env = agyEnv({ cli: false, version: "0.1.602", config });
    const facts = await plan(root, env);
    expect(facts.harnesses.at(-1)).toMatchObject({
      id: "antigravity",
      onPath: false,
      plugin: { version: "0.1.602", scope: "user", disabled: true },
    });
    expect(await planText(root, env)).toContain(
      "  antigravity: not on the PATH, plugin 0.1.602 (user)\n    disabled: the Squeal plugin is disabled in ~/.gemini/config/config.json (agy plugin enable squeal enables it)\n",
    );
  });

  it("sets Antigravity up with --harness antigravity, writing the block to AGENTS.md", async () => {
    const root = squealShaped();
    const env = agyEnv({ version: "0.1.602" });
    const { io, out } = capture(root, env);
    const args = ["setup", "--yes", "--no-warmup", "--harness", "antigravity"];
    expect(await main([...args, "--block", "AGENTS.md"], io)).toBe(0);
    expect(out.stderr).toBe("");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("<!-- squeal:begin v1");
    // Antigravity's own config is never written (D1).
    expect(
      readFileSync(join(env.HOME as string, ".gemini/config/plugins/squeal/plugin.json"), "utf8"),
    ).toBe(JSON.stringify({ version: "0.1.602" }));
  });

  it("asks about Antigravity when it is found, and offers it the AGENTS.md block", async () => {
    const root = withAgents();
    const { io, out } = capture(root, agyEnv({ version: "0.1.602" }));
    expect(await main(["setup", "--yes", "--no-warmup"], io)).toBe(0);
    expect(out.stdout).toContain(
      "Set up Antigravity here (on the PATH, plugin 0.1.602)?\n  yes (default, --yes)\n",
    );
    expect(out.stdout).toContain(
      "Write the Squeal block to AGENTS.md (read by Antigravity)?\n  write it (default, --yes)\n",
    );
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("<!-- squeal:begin v1");
  });

  it("sets Antigravity up with --harness antigravity even when neither CLI nor plugin is detected (review 0.1.603 B1)", async () => {
    const root = bareRepo();
    const env = harnessEnv();
    const { io, out } = capture(root, env);
    const code = await main(["setup", "--yes", "--no-warmup", "--harness", "antigravity"], io);
    expect(code).toBe(0);
    expect(out.stderr).toBe("");
    expect(existsSync(join(root, "squeal.config.json"))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("<!-- squeal:begin v1");
    expect(out.stdout).toContain(ANTIGRAVITY_INSTALL_COMMAND);
    expect(out.stdout).toContain("Write the Squeal block to AGENTS.md (read by Antigravity;");
    expect(readdirSync(env.HOME as string)).toEqual(["bin"]);
  });

  it("sets Antigravity up with explicit --harness antigravity and --block AGENTS.md when undetected", async () => {
    const root = bareRepo();
    const env = harnessEnv();
    const { io, out } = capture(root, env);
    const args = ["setup", "--yes", "--no-warmup", "--harness", "antigravity"];
    expect(await main([...args, "--block", "AGENTS.md"], io)).toBe(0);
    expect(out.stderr).toBe("");
    expect(existsSync(join(root, "squeal.config.json"))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("<!-- squeal:begin v1");
    expect(out.stdout).toContain(ANTIGRAVITY_INSTALL_COMMAND);
  });

  it("refuses an unknown --harness, naming antigravity among the values", async () => {
    const root = squealShaped();
    const { io, out } = capture(root, harnessEnv());
    expect(await main(["setup", "--harness", "gemini"], io)).toBe(2);
    expect(out.stderr).toContain(
      '--harness takes claude-code, codex, antigravity or none, not "gemini"',
    );
  });
});
