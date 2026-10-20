import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { compare } from "../../../src/core/fs/index.js";
import { type Component, FORMAT_FILE } from "./components.js";

/*
 * The two trees the comparison runs (011 C3, task 011-37 section 3): the
 * candidate, this checkout, and the last release, read from its tag with
 * `git archive` into a temporary directory.
 */

export const ROOT = join(import.meta.dirname, "../../..");

/** A file's replacement text in the candidate, for checking a change unmade. */
export type Overlay = Readonly<Record<string, string>>;

/** What `git archive` takes from the last release: the sources, what esbuild reads, the lock. */
const ARCHIVED = ["src", "tsconfig.json", "package.json", "package-lock.json"];

/** The bundler, fingerprinted beside the packages a bundle imports: its output is the code compared. */
const BUNDLER = "esbuild";

const git = (root: string, args: readonly string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** The newest `squeal--v*` tag that is an ancestor of `HEAD`; throws naming the fetch when none is. */
export function lastRelease(root = ROOT): string {
  try {
    return git(root, ["describe", "--tags", "--abbrev=0", "--match", "squeal--v*", "HEAD"]);
  } catch {
    throw new Error(
      "no squeal--v* tag is an ancestor of HEAD: run `git fetch --tags` (a shallow clone needs its history too)",
    );
  }
}

/** Extracts `ref`'s sources, `tsconfig.json` and manifests into `into`. */
export function extractTree(ref: string, into: string, root = ROOT): void {
  mkdirSync(into, { recursive: true });
  const tar = execFileSync("git", ["-C", root, "archive", "--format=tar", ref, ...ARCHIVED], {
    maxBuffer: 512 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", into], { input: tar });
}

/** `path`'s text in `tree`, `overlay`'s in place. */
const textAt = (tree: string, path: string, overlay: Overlay) =>
  overlay[path] ?? readFileSync(join(tree, path), "utf8");

/** `component`'s version as the tree's source states it: the format's number, an adapter's string. */
export function versionOf(tree: string, component: Component, overlay: Overlay = {}): string {
  const { path, constant } = component.version;
  const value = new RegExp(`${constant} = "?([^";]+)"?;`).exec(textAt(tree, path, overlay))?.[1];
  if (value === undefined) throw new Error(`${path}: no ${constant} in ${tree}`);
  return value;
}

/** The formats `KEY_FORMATS_READ_AS_ONE` lists in the tree's source. */
export function readAsOneOf(tree: string, overlay: Overlay = {}): number[] {
  const text = textAt(tree, FORMAT_FILE, overlay);
  const list = /KEY_FORMATS_READ_AS_ONE[^=]*= \{([^}]*)\}/.exec(text)?.[1];
  if (list === undefined) throw new Error(`${FORMAT_FILE}: no KEY_FORMATS_READ_AS_ONE in ${tree}`);
  return [...list.matchAll(/^\s*(\d+):/gm)].map((m) => Number(m[1]));
}

interface LockEntry {
  readonly version?: string;
  readonly integrity?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Where Node finds `name` from the package at `from` ("" is the root), in the lock. */
function locate(packages: Record<string, LockEntry>, from: string, name: string): string | null {
  let dir = from;
  for (;;) {
    const location = posix.join(dir, "node_modules", name);
    if (packages[location] !== undefined) return location;
    if (dir === "") return null;
    const at = dir.lastIndexOf("/node_modules/");
    dir = at < 0 ? "" : dir.slice(0, at);
  }
}

/** The package a bare import names: `a` of `a/b`, `@s/a` of `@s/a/b`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/**
 * `location@version#integrity` of the lock closure of `imported`, the packages
 * a bundle imports, and of the bundler, sorted. Two trees with equal lists run
 * one bundle's externals from the same install.
 */
export function dependencyLines(
  tree: string,
  imported: Iterable<string>,
  overlay: Overlay = {},
): string[] {
  const lock = JSON.parse(textAt(tree, "package-lock.json", overlay)) as {
    packages: Record<string, LockEntry>;
  };
  const seen = new Set<string>();
  const visit = (from: string, name: string, required: boolean) => {
    const location = locate(lock.packages, from, name);
    if (location === null) {
      if (required)
        throw new Error(`${tree}/package-lock.json: ${name} (from "${from}") not found`);
      return;
    }
    if (seen.has(location)) return;
    seen.add(location);
    const entry = lock.packages[location] ?? {};
    for (const dep of Object.keys(entry.dependencies ?? {})) visit(location, dep, true);
    for (const dep of Object.keys({ ...entry.optionalDependencies, ...entry.peerDependencies })) {
      visit(location, dep, false);
    }
  };
  for (const name of new Set(imported)) visit("", name, true);
  visit("", BUNDLER, true);
  return [...seen].sort(compare).map((location) => {
    const { version, integrity } = lock.packages[location] ?? {};
    return `${location}@${version}#${integrity}`;
  });
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
