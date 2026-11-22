import { chmodSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Machine, writePlugin } from "./install-fixture.js";

/*
 * Spec 024 D1 on a scratch machine of install-fixture.ts: a stub Antigravity
 * CLI and the paths it owns. The stub behaves as `antigravity` 1.5.14 did in
 * research/wave-0-checks.md 1 and 2: `--version` prints a bare semver, `help
 * plugin` lists the plugin subcommands, `plugin install <dir>` copies the tree
 * into ~/.gemini/config/plugins/<name> and replaces an earlier copy in place,
 * and `plugin uninstall <name>` exits 0 whether or not it is installed. As
 * `ide`, it is the Antigravity IDE launcher: a multi-line `--version` and no
 * plugin subcommands. Each call goes to `STUB_LOG` under the name it was
 * called by.
 */

const STUB = (ide: boolean) => `#!${process.execPath}
const fs = require("node:fs");
const p = require("node:path");
const tool = p.basename(process.argv[1]);
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.STUB_LOG, JSON.stringify({ tool, args }) + "\\n");
const fail = (m) => { process.stderr.write(m + "\\n"); process.exit(1); };
const cmd = args.join(" ");
if (${ide}) {
  if (cmd === "--version") console.log("1.107.0\\n0123abcd\\nx64");
  else console.log("Usage: antigravity [options][paths...]");
  process.exit(0);
}
const plugins = p.join(env.HOME, ".gemini", "config", "plugins");
if (cmd === "--version") console.log("1.5.14");
else if (cmd === "help plugin")
  console.log("Usage of " + tool + " plugin:\\n  install <path>\\n  uninstall <name>\\n  enable <name>\\n  disable <name>\\n  list\\n  validate <path>");
else if (args[0] === "plugin" && args[1] === "install" && args.length === 3) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(p.join(args[2], "plugin.json"), "utf8")); } catch { fail("no plugin at " + args[2]); }
  const to = p.join(plugins, manifest.name);
  const replaced = fs.existsSync(to);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(plugins, { recursive: true });
  fs.cpSync(args[2], to, { recursive: true });
  console.log("Installed plugin \\"" + manifest.name + "\\"" + (replaced ? " (replaced existing installation)" : ""));
} else if (args[0] === "plugin" && args[1] === "uninstall" && args.length === 3) {
  fs.rmSync(p.join(plugins, args[2]), { recursive: true, force: true });
  console.log("Uninstalled plugin \\"" + args[2] + "\\"");
} else fail("stub: unknown command " + cmd);
`;

/** Writes the stub as `name` in `dir`, the machine's PATH stubs by default; returns its path. */
export function antigravityCli(
  m: Machine,
  options: { name?: string; dir?: string; ide?: boolean } = {},
): string {
  const dir = options.dir ?? join(m.root, "stubs");
  const path = join(dir, options.name ?? "agy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, STUB(options.ide ?? false));
  chmodSync(path, 0o755);
  return path;
}

/** Where `agy plugin install` puts Squeal: PLUGIN_ROOT of its hooks. */
export const antigravityPluginOf = (m: Machine): string =>
  join(m.home, ".gemini", "config", "plugins", "squeal");

/** PLUGIN_DATA of Squeal's hooks, which `plugin uninstall` keeps. */
export const antigravityDataOf = (m: Machine): string =>
  join(m.home, ".gemini", "antigravity-cli", "plugin_data", "squeal");

/** Squeal installed in Antigravity at `version` without install.sh, as `agy plugin install` leaves it. */
export function antigravityInstalls(m: Machine, version: string): void {
  writePlugin(antigravityPluginOf(m), "antigravity", version);
}

/** The data directory as SessionStart leaves it: a retained copy of `version` and the launcher; returns the launcher. */
export function antigravityKeeps(m: Machine, version: string, launcher: string): string {
  const data = antigravityDataOf(m);
  writePlugin(join(data, "versions", version), "antigravity", version);
  mkdirSync(join(data, "bin"), { recursive: true });
  writeFileSync(join(data, "bin", "squeal"), launcher);
  chmodSync(join(data, "bin", "squeal"), 0o755);
  return join(data, "bin", "squeal");
}

/** A TMPDIR of its own, so a test sees that install.sh leaves no staging directory. */
export function scratchTmp(m: Machine): string {
  const tmp = join(m.root, "tmp");
  mkdirSync(tmp, { recursive: true });
  m.env.TMPDIR = tmp;
  return tmp;
}

export const entriesOf = (dir: string): string[] => readdirSync(dir).sort();
