import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import type { AbsolutePath, RelativePath } from "../../../types/common.js";

/*
 * Spec 017 D11 "Key": the config files that decide a file's oxlint
 * findings (`research/oxlint-provider.md` Q1, Q2). One config per folder,
 * nested ones not merged; a JSON config's `extends` names files. A JS or TS
 * config imports its bases: the preload sees what it reads.
 */

export const CONFIG_NAMES = [
  ".oxlintrc.json",
  ".oxlintrc.jsonc",
  "oxlint.config.ts",
  "oxlint.config.mts",
] as const;

/** Read from the working directory, the root (D11). */
export const ROOT_INPUTS = [".eslintignore", "oxlint-suppressions.json"] as const;

const SKIP = new Set(["node_modules", ".git"]);

/** A path whose change re-reads oxlint's configs: a config at any depth, or a root input. */
export function isOxlintConfigInput(path: RelativePath): boolean {
  const name = basename(path);
  return (
    (CONFIG_NAMES as readonly string[]).includes(name) ||
    (ROOT_INPUTS as readonly string[]).includes(path)
  );
}

/** The config file in `dir`, relative to `root`, or `null`. */
export function configIn(root: AbsolutePath, dir: RelativePath | ""): RelativePath | null {
  for (const name of CONFIG_NAMES) {
    if (existsSync(join(root, dir, name))) return toRelative(posix.join(dir, name));
  }
  return null;
}

/** Every config under the root, nested ones included; `node_modules` and `.git` left out. */
export function findConfigs(root: AbsolutePath): RelativePath[] {
  const found: RelativePath[] = [];
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory() && !SKIP.has(entry.name)) walk(rel);
      else if ((CONFIG_NAMES as readonly string[]).includes(entry.name))
        found.push(rel as RelativePath);
    }
  };
  walk("");
  return found.sort();
}

/** What a config and the files it extends say, as far as JSON can be read. */
export interface ConfigFacts {
  /** The config and every file its `extends` names, transitively, relative to the root. */
  readonly files: readonly RelativePath[];
  /** The import plugin is on: D5's program segment (D11). A JS or TS config counts as on. */
  readonly importPlugin: boolean;
  /** Local JS plugin entries, relative to the root; a package's is the install's. */
  readonly jsPlugins: readonly RelativePath[];
}

export function configFacts(root: AbsolutePath, config: RelativePath): ConfigFacts {
  const files: RelativePath[] = [];
  const jsPlugins: RelativePath[] = [];
  let importPlugin = false;
  const visit = (path: RelativePath) => {
    if (files.includes(path)) return;
    files.push(path);
    const json = /\.jsonc?$/.test(path) ? readJsonc(join(root, path)) : null;
    if (json === null) {
      importPlugin ||= !/\.jsonc?$/.test(path);
      return;
    }
    importPlugin ||= usesImport(json);
    for (const entry of strings(json.jsPlugins)) {
      if (entry.startsWith(".")) jsPlugins.push(toRelative(posix.join(posix.dirname(path), entry)));
    }
    for (const base of strings(json.extends))
      visit(toRelative(posix.join(posix.dirname(path), base)));
  };
  visit(config);
  return { files, importPlugin, jsPlugins };
}

type Json = Record<string, unknown>;

function usesImport(config: Json): boolean {
  const named = (c: Json) =>
    strings(c.plugins).some((p) => p === "import" || p === "eslint-plugin-import") ||
    Object.keys((c.rules as Json | undefined) ?? {}).some((r) => r.startsWith("import/"));
  const overrides = Array.isArray(config.overrides) ? (config.overrides as Json[]) : [];
  return named(config) || overrides.some((o) => typeof o === "object" && o !== null && named(o));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A `.json` or `.jsonc` config: comments and trailing commas allowed; `null` when it does not parse. */
export function readJsonc(path: string): Json | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const value: unknown = JSON.parse(stripJsonc(text));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Json)
      : null;
  } catch {
    return null;
  }
}

/** JSON with comments and trailing commas as plain JSON; strings are kept as they are. */
export function stripJsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end - 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}

/**
 * D11: the config chain of one file, from its folder up to the root: each
 * folder's config or none, then the root's. oxlint uses the nearest; the
 * chain also names the folders without one, so a new config there re-keys.
 */
export function chainOf(
  root: AbsolutePath,
  file: RelativePath,
): readonly (readonly [string, RelativePath | null])[] {
  const chain: [string, RelativePath | null][] = [];
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    const here = dir === "." ? "" : dir;
    const config = configIn(root, here);
    chain.push([here, config]);
    if (config !== null || here === "") return chain;
  }
}

/** The first config above the root, relative to it (`../.oxlintrc.json`), or `null`. */
export function configAbove(root: AbsolutePath): RelativePath | null {
  for (let dir = dirname(root); ; dir = dirname(dir)) {
    for (const name of CONFIG_NAMES) {
      if (existsSync(join(dir, name))) return toRelative(relative(root, join(dir, name)));
    }
    if (dirname(dir) === dir) return null;
  }
}

function toRelative(path: string): RelativePath {
  return path.split(sep).join("/") as RelativePath;
}
