import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { compare, isMissing } from "../../../core/fs/index.js";
import type { AbsolutePath } from "../../../core/types/index.js";

/** `pyvenv.cfg` as `key = value` pairs, keys and values trimmed, as `site` reads it. */
export function parsePyvenvCfg(text: string): Readonly<Record<string, string>> {
  const pairs: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) pairs[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return pairs;
}

/** `pyvenv.cfg` of `env`, or `null` when there is none (a conda prefix, a bare interpreter). */
export function readPyvenvCfg(env: AbsolutePath): Readonly<Record<string, string>> | null {
  const text = readOptional(join(env, "pyvenv.cfg"));
  return text === null ? null : parsePyvenvCfg(text);
}

/** `3.13` from `version_info = 3.13` (uv) or `version = 3.13.14` (venv), else `null`. */
export function minorVersion(cfg: Readonly<Record<string, string>> | null): string | null {
  const match = /^(\d+)\.(\d+)/.exec(cfg?.version_info ?? cfg?.version ?? "");
  return match === null ? null : `${match[1]}.${match[2]}`;
}

/**
 * The environment's site-packages: `lib/python<X.Y>/site-packages` for the
 * version `pyvenv.cfg` names, else the one `lib/*\/site-packages` there is
 * (PyPy's `lib/pypy3.X`, a conda prefix). `null` when there is none.
 */
export function sitePackagesDir(env: AbsolutePath): AbsolutePath | null {
  const lib = join(env, "lib");
  const names = listOptional(lib);
  const version = minorVersion(readPyvenvCfg(env));
  const named = version === null ? undefined : names.find((name) => name === `python${version}`);
  const candidates = named === undefined ? names : [named];
  const withSite = candidates.filter((name) =>
    listOptional(join(lib, name)).includes("site-packages"),
  );
  return withSite.length === 1 ? join(lib, withSite[0] as string, "site-packages") : null;
}

/** Entry names of a directory in code-unit order; `[]` when it is missing. */
export function listOptional(dir: AbsolutePath): readonly string[] {
  try {
    return readdirSync(dir).sort(compare);
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return [];
    throw error;
  }
}

export function readOptional(path: AbsolutePath): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** `.pth` files of a site directory in the order `site.addsitedir` processes them. */
export function pthFiles(site: AbsolutePath): readonly string[] {
  return listOptional(site).filter((name) => name.endsWith(".pth") && !name.startsWith("."));
}

/**
 * The standard library directories `home` in `pyvenv.cfg` implies: the
 * interpreter's `bin` sits beside `lib/python<X.Y>` and its `lib-dynload`.
 * Empty when `home` or the version is absent.
 */
export function stdlibDirs(cfg: Readonly<Record<string, string>> | null): readonly AbsolutePath[] {
  const version = minorVersion(cfg);
  const home = cfg?.home;
  if (version === null || home === undefined || !isAbsolute(home)) return [];
  const stdlib = resolve(home, "..", "lib", `python${version}`);
  return [stdlib, join(stdlib, "lib-dynload")];
}
