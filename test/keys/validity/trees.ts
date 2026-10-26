import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Component, FORMAT_FILE } from "./components.js";
import { closureLines, LOCKFILES, lockfileIn, lockGraph, pnpmProject } from "./lock.js";

/*
 * The two trees the comparison runs (011 C3, task 011-37 section 3): the
 * candidate, this checkout, and the last release, read from its tag with
 * `git archive` into a temporary directory.
 */

export const ROOT = join(import.meta.dirname, "../../..");

/** A file's replacement text in the candidate, for checking a change unmade. */
export type Overlay = Readonly<Record<string, string>>;

/**
 * What `git archive` takes from the last release, where the ref has it: the
 * sources, what esbuild reads, the lock and the files a frozen install of
 * it reads (row 017-11), besides each pnpm workspace's manifest.
 */
const ARCHIVED = ["src", "tsconfig.json", "package.json", ...LOCKFILES, "pnpm-workspace.yaml"];

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

/** Extracts `ref`'s sources, `tsconfig.json`, manifests and lock into `into`. */
export function extractTree(ref: string, into: string, root = ROOT): void {
  mkdirSync(into, { recursive: true });
  const held = git(root, ["ls-tree", "--name-only", ref, "--", ...ARCHIVED]).split("\n");
  const lock = lockfileIn(ref, (path) => held.includes(path));
  const workspaces =
    lock === "pnpm-lock.yaml"
      ? [...pnpmProject(git(root, ["show", `${ref}:${lock}`]), `${ref}:${lock}`).importers.keys()]
          .filter((importer) => importer !== ".")
          .map((importer) => `${importer}/package.json`)
      : [];
  const paths = [...held, ...workspaces];
  const tar = execFileSync("git", ["-C", root, "archive", "--format=tar", ref, ...paths], {
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

/** The package a bare import names: `a` of `a/b`, `@s/a` of `@s/a/b`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/**
 * The lock closure of `imported`, the packages a bundle imports, and of the
 * bundler, as `closureLines` gives it from npm's lock or pnpm's. Two trees
 * with equal lists run one bundle's externals on the same packages.
 */
export function dependencyLines(
  tree: string,
  imported: Iterable<string>,
  overlay: Overlay = {},
): string[] {
  const has = (path: string) => overlay[path] !== undefined || existsSync(join(tree, path));
  const lock = lockfileIn(tree, has);
  const where = `${tree}/${lock}`;
  return closureLines(
    lockGraph(lock, textAt(tree, lock, overlay), where),
    [...imported, BUNDLER],
    where,
  );
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
