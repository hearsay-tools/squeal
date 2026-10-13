import type { Ran } from "./isolated.js";
import { type Machine, ok } from "./machine.js";

/*
 * What a scratch machine holds, read as the throwaway user the way the
 * launcher reads it (spec 005 D3): Claude Code's `installed_plugins.json`,
 * the Codex plugin cache, the record `install.sh` keeps.
 */

/** Claude Code's user-scope `squeal@hearsay` versions whose install directory exists. */
export async function claudeVersions(m: Machine): Promise<string[]> {
  const r = await m.run("node", [
    "-e",
    `const fs = require("node:fs");
let file = { plugins: {} };
try { file = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
const list = (file.plugins ?? {})["squeal@hearsay"] ?? [];
console.log(JSON.stringify(list.filter((e) => e.scope === "user" && fs.existsSync(e.installPath)).map((e) => e.version)));`,
    `${m.claudeConfig}/plugins/installed_plugins.json`,
  ]);
  return JSON.parse(ok(r, "read installed_plugins.json").stdout) as string[];
}

/** The versions in the Codex plugin cache. */
export async function codexVersions(m: Machine): Promise<string[]> {
  return list(m, `${m.codexHome}/plugins/cache/hearsay/squeal`);
}

/** The entries of `dir`, sorted; empty when it does not exist. */
export async function list(m: Machine, dir: string): Promise<string[]> {
  const r = ok(await m.sh('[ -d "$1" ] || exit 0; ls -A "$1"', [dir]), `ls ${dir}`);
  return r.stdout.split("\n").filter((l) => l !== "").sort();
}

export async function exists(m: Machine, path: string): Promise<boolean> {
  return (await m.sh('[ -e "$1" ] || [ -L "$1" ]', [path])).status === 0;
}

/** The record `install.sh` keeps of what it created. */
export const ownedRecord = (m: Machine) => `${m.home}/.local/state/squeal/installed`;

/**
 * Every entry under each of `dirs` with its mode and a hash of its content
 * (a link: its target), for "a second run changed nothing".
 */
export async function snapshot(m: Machine, dirs: readonly string[]): Promise<object> {
  const r = await m.run("node", [
    "-e",
    `const fs = require("node:fs");
const { createHash } = require("node:crypto");
const out = {};
const walk = (o, root, at) => {
  for (const name of fs.readdirSync(at)) {
    const p = at + "/" + name;
    const st = fs.lstatSync(p);
    const key = p.slice(root.length);
    if (st.isSymbolicLink()) o[key] = "-> " + fs.readlinkSync(p);
    else if (st.isDirectory()) walk(o, root, p);
    else o[key] = (st.mode & 0o777).toString(8) + " " + createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  }
};
for (const d of process.argv.slice(1)) { out[d] = {}; if (fs.existsSync(d)) walk(out[d], d, d); }
console.log(JSON.stringify(out));`,
    ...dirs,
  ]);
  return JSON.parse(ok(r, "snapshot").stdout) as object;
}

/** A failure message that shows what the command printed. */
export const shown = (r: Ran) =>
  `exit ${r.status ?? r.signal}${r.timedOut ? " (timed out)" : ""}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;
