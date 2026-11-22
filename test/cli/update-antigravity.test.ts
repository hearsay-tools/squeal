import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { cleanupFixtures, scratch } from "./setup/fixture.js";

/*
 * Spec 024 D1 with 005 D3, `squeal update` in Antigravity: with the CLI
 * passing detection and the plugin installed, it runs the latest release's
 * `install.sh --antigravity`; it says when the plugin is disabled, and when
 * the plugin directory has no CLI to update it with, naming
 * `SQUEAL_ANTIGRAVITY_BIN`. The launcher is re-copied from the plugin too.
 */

afterEach(cleanupFixtures);

const AGY = `#!/bin/sh
case "$1" in
  --version) echo 1.5.14 ;;
  help) printf 'Usage of agy plugin:\\n  install <dir>\\n  uninstall <name>\\n  validate <dir>\\n' ;;
  *) exit 1 ;;
esac
`;

interface Machine {
  readonly home: string;
  readonly env: Record<string, string>;
  /** The arguments each `install.sh` run got, one line per run. */
  readonly log: string;
  readonly plugin: string;
}

/**
 * A HOME with `bin` as the whole PATH (`curl` and `sh` linked in), the
 * plugin at `version` when given, and a stand-in for the latest
 * `install.sh` that logs its arguments and installs `next`.
 */
function machine(options: { cli?: boolean; version?: string; config?: unknown; next?: string }) {
  const home = scratch("squeal-agy-update-");
  const bin = join(home, "bin");
  mkdirSync(bin);
  for (const tool of ["curl", "sh"]) {
    symlinkSync(
      execFileSync("sh", ["-c", `command -v ${tool}`])
        .toString()
        .trim(),
      join(bin, tool),
    );
  }
  if (options.cli !== false) {
    writeFileSync(join(bin, "agy"), AGY);
    chmodSync(join(bin, "agy"), 0o755);
  }
  const plugin = join(home, ".gemini", "config", "plugins", "squeal");
  if (options.version !== undefined) {
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ version: options.version }));
  }
  if (options.config !== undefined) {
    writeFileSync(join(home, ".gemini", "config", "config.json"), JSON.stringify(options.config));
  }
  const log = join(home, "install-sh.log");
  const script = join(home, "latest-install.sh");
  writeFileSync(
    script,
    `echo "$*" >> ${log}\nprintf '{"version":"${options.next ?? "0.1.603"}"}' > ${join(plugin, "plugin.json")}\n`,
  );
  const env = { HOME: home, PATH: bin, SQUEAL_INSTALL_SH: `file://${script}` };
  return { home, env, log, plugin };
}

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

const logged = (m: Machine) => {
  try {
    return readFileSync(m.log, "utf8");
  } catch {
    return "";
  }
};

describe("squeal update in Antigravity (spec 024 D1)", () => {
  it("runs the latest install.sh --antigravity when agy passes detection and the plugin is installed", async () => {
    const m = machine({ version: "0.1.602" });
    const r = await update(m);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(logged(m)).toBe("--antigravity\n");
    expect(r.stdout).toMatch(
      new RegExp(
        `^\\$ curl -fsSL -o (\\S+)/install\\.sh ${m.env.SQUEAL_INSTALL_SH}\n\\$ sh \\1/install\\.sh --antigravity\n`,
      ),
    );
    expect(r.stdout).toContain("Antigravity: Squeal 0.1.603, was 0.1.602\n");
    expect(r.stdout).not.toContain("disabled");
  });

  it("updates a disabled plugin too, and says Antigravity has it disabled", async () => {
    const config = { plugins: { squeal: { enabled: false } } };
    const m = machine({ version: "0.1.602", config });
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(logged(m)).toBe("--antigravity\n");
    expect(r.stdout).toContain(
      "Antigravity: Squeal 0.1.603, was 0.1.602\nAntigravity: the Squeal plugin is disabled in ~/.gemini/config/config.json (agy plugin enable squeal enables it)\n",
    );
  });

  it("names SQUEAL_ANTIGRAVITY_BIN when the plugin is installed and no CLI passes detection", async () => {
    const m = machine({ cli: false, version: "0.1.602" });
    // An IDE launcher named antigravity is not the CLI.
    writeFileSync(join(m.env.PATH, "antigravity"), '#!/bin/sh\necho "Antigravity IDE"\n');
    chmodSync(join(m.env.PATH, "antigravity"), 0o755);
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(logged(m)).toBe("");
    expect(r.stderr).toContain(
      `squeal update: Antigravity has the Squeal plugin 0.1.602 in ${m.plugin}, but no Antigravity CLI was found: neither agy nor antigravity on the PATH prints a version and lists plugin uninstall and validate. Set SQUEAL_ANTIGRAVITY_BIN to the CLI's path and run squeal update again\n`,
    );
  });

  it("takes the CLI SQUEAL_ANTIGRAVITY_BIN names, off the PATH", async () => {
    const m = machine({ cli: false, version: "0.1.602" });
    const managed = join(m.home, "tools", "antigravity");
    mkdirSync(join(m.home, "tools"));
    writeFileSync(managed, AGY);
    chmodSync(managed, 0o755);
    const r = await update({ ...m, env: { ...m.env, SQUEAL_ANTIGRAVITY_BIN: managed } });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(logged(m)).toBe("--antigravity\n");
  });

  it("leaves Antigravity out when its plugin is not installed, though agy is on the PATH", async () => {
    const m = machine({});
    const r = await update(m);
    expect(r.code).toBe(1);
    expect(logged(m)).toBe("");
    expect(r.stderr).toContain(
      "squeal update: no harness on the PATH has squeal@hearsay installed",
    );
    expect(r.stderr).not.toContain("SQUEAL_ANTIGRAVITY_BIN");
  });

  it("re-copies the launcher from the Antigravity plugin when it ships a newer format", async () => {
    const m = machine({ version: "0.1.602" });
    mkdirSync(join(m.home, ".local", "bin"), { recursive: true });
    const target = join(m.home, ".local", "bin", "squeal");
    writeFileSync(target, "#!/bin/sh\n# squeal-launcher format 8\n");
    mkdirSync(join(m.plugin, "bin"));
    writeFileSync(
      join(m.plugin, "bin", "squeal-launcher"),
      "#!/bin/sh\n# squeal-launcher format 9\n",
    );
    const r = await update(m);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Copied the launcher (format 8, now 9) to ${target}\n`);
    expect(readFileSync(target, "utf8")).toContain("format 9");
  });
});
