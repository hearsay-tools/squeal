import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isRecord } from "../core/fs/index.js";
import { compareVersions } from "./setup/harnesses.js";

/*
 * The packages `install.sh` unpacks for Pi (spec 009 D1) and OpenCode (spec
 * 008 D1), as `squeal update` finds them: only one the harness's own settings
 * list, since a Squeal package installed from elsewhere is the user's and
 * `install.sh` would not replace it.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** Where `install.sh` unpacks the Pi or OpenCode packages, one directory per version. */
export function packagesHome(harness: "pi" | "opencode", env: Env): string {
  return join(env.XDG_DATA_HOME || join(env.HOME ?? "", ".local", "share"), "squeal", harness);
}

/**
 * The newest Pi package of `install.sh` that Pi's user settings list: a local
 * source, relative to Pi's agent directory, under `packagesHome("pi")`. A Squeal package
 * installed from elsewhere is the user's, and `install.sh` would not replace it.
 */
export function piPackage(env: Env): { readonly version: string } | null {
  const home = env.HOME ?? "";
  let agent = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
  if (agent === "~") agent = home;
  else if (agent.startsWith("~/")) agent = join(home, agent.slice(2));
  let packages: unknown = [];
  try {
    const file: unknown = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    if (isRecord(file)) packages = file.packages;
  } catch {
    return null;
  }
  const versions: string[] = [];
  for (const entry of Array.isArray(packages) ? packages : []) {
    const source = isRecord(entry) ? entry.source : entry;
    if (typeof source !== "string" || /^(npm|git|https?|ssh):/.test(source)) continue;
    const dir = resolve(agent, source);
    if (resolve(dir, "..") !== resolve(packagesHome("pi", env))) continue;
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (isRecord(manifest) && typeof manifest.version === "string")
        versions.push(manifest.version);
    } catch {
      // Listed but gone: Pi itself skips it.
    }
  }
  const newest = versions.sort(compareVersions).at(-1);
  return newest === undefined ? null : { version: newest };
}

/**
 * The package `install.sh`'s `current` link names, when OpenCode's global
 * config lists that link: `opencode.json`, `opencode.jsonc` or `config.json`
 * under `$XDG_CONFIG_HOME/opencode`. A JSONC file that JSON cannot parse is
 * searched for the spec as JSON writes it, as `install.sh` does.
 */
export function openCodePackage(env: Env): { readonly version: string } | null {
  const link = join(packagesHome("opencode", env), "current");
  const spec = `file:${link}`;
  const config = join(env.XDG_CONFIG_HOME || join(env.HOME ?? "", ".config"), "opencode");
  const listed = ["opencode.json", "opencode.jsonc", "config.json"].some((name) => {
    let text: string;
    try {
      text = readFileSync(join(config, name), "utf8");
    } catch {
      return false;
    }
    try {
      const file: unknown = JSON.parse(text);
      const plugins = isRecord(file) && Array.isArray(file.plugin) ? file.plugin : [];
      return plugins.some((p: unknown) => (Array.isArray(p) ? p[0] : p) === spec);
    } catch {
      return text.includes(JSON.stringify(spec));
    }
  });
  if (!listed) return null;
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(link, "package.json"), "utf8"));
    return isRecord(manifest) && typeof manifest.version === "string"
      ? { version: manifest.version }
      : null;
  } catch {
    // Listed, but the link names no package: install.sh --uninstall left the entry.
    return null;
  }
}
