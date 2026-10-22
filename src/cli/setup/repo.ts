import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { loadPolicy } from "../../core/daemon/policy.js";
import { isRecord, runGit, splitNul, worktreeIdFor } from "../../core/fs/index.js";
import { createInputMatcher, globToRegExp } from "../../core/keys/glob.js";
import { withStatusStore } from "../../core/status/index.js";
import type { AbsolutePath } from "../../core/types/index.js";
import { readVerdict } from "../verdict.js";

/*
 * Read-only facts of one worktree for `squeal setup --plan` (spec 005 D3
 * step 2): its tracked files, its manifests and its test files. Nothing here
 * writes, and no repository code is loaded or run: configs are read as text.
 */

/** A `package.json`, by its directory relative to the root (`""` for the root). */
export interface Manifest {
  readonly dir: string;
  readonly value: Record<string, unknown>;
}

/** What the plan reads once and every part shares. */
export interface RepoFacts {
  readonly root: AbsolutePath;
  /** `git ls-files`, worktree-relative. */
  readonly tracked: readonly string[];
  readonly manifests: readonly Manifest[];
  readonly testFiles: TestFiles;
}

/**
 * The worktree's test files. `store` when a daemon listed them (both
 * runners); else `config-text` from the `include` and `exclude` string
 * arrays of a Vitest config read as text, or `default` from Vitest's own
 * defaults, over the tracked files.
 */
export interface TestFiles {
  readonly source: "store" | "config-text" | "default";
  readonly paths: readonly string[];
  /** Of `runs`, those with a current result; `null` when no daemon listed them. */
  readonly current: number | null;
  /** One per project and test file the daemon listed, as it runs them (row 005-80); `null` when none did. */
  readonly runs: number | null;
}

export async function readRepoFacts(root: AbsolutePath): Promise<RepoFacts> {
  const tracked = splitNul(await runGit(root, ["ls-files", "-z"]));
  const manifests: Manifest[] = [];
  for (const path of tracked) {
    if (posix.basename(path) !== "package.json" || path.split("/").includes("node_modules"))
      continue;
    const value = readJson(join(root, path));
    if (isRecord(value)) manifests.push({ dir: posix.dirname(path).replace(/^\.$/, ""), value });
  }
  return { root, tracked, manifests, testFiles: listTestFiles(root, tracked) };
}

/** The parsed JSON at `path`, or `null` when it is missing or not JSON. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** The text at `path`, or `null` when it cannot be read. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The manifest whose directory is nearest above `dir`, the root's when none is. */
export function nearestManifest(facts: RepoFacts, dir: string): Manifest {
  for (let d = dir; ; d = posix.dirname(d)) {
    const key = d === "." ? "" : d;
    const found = facts.manifests.find((m) => m.dir === key);
    if (found !== undefined) return found;
    if (key === "") return { dir: "", value: {} };
  }
}

/** The manifest's `scripts` that are strings. */
export function scriptsOf(manifest: Manifest): [string, string][] {
  const scripts = manifest.value.scripts;
  if (!isRecord(scripts)) return [];
  return Object.entries(scripts).filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string";
  });
}

/** Whether git tracks `path` (worktree-relative). */
export function isTracked(facts: RepoFacts, path: string): boolean {
  return facts.tracked.includes(path);
}

/** The worktree root of every other worktree git lists, the main checkout first. */
export async function otherWorktrees(root: AbsolutePath): Promise<string[]> {
  const out = await runGit(root, ["worktree", "list", "--porcelain", "-z"]).catch(() => "");
  return splitNul(out)
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length))
    .filter((path) => path !== root);
}

/** Of `paths` (worktree-relative directories), those git ignores. */
export async function ignoredDirs(root: AbsolutePath, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const out = await runGit(root, ["check-ignore", "--no-index", "--stdin", "-z"], {
    input: paths.map((p) => `${p}/\0`).join(""),
    okCodes: [0, 1],
  });
  return splitNul(out).map((p) => p.replace(/\/$/, ""));
}

/** Gitignored directories that exist, `node_modules` and `.git` left out. */
export async function existingIgnoredDirs(root: AbsolutePath): Promise<string[]> {
  const out = await runGit(root, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "-z",
  ]);
  return splitNul(out)
    .filter((p) => p.endsWith("/"))
    .map((p) => p.replace(/\/$/, ""))
    .filter((p) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(p));
}

const VITEST_CONFIGS = ["vitest.config", "vite.config"].flatMap((base) =>
  ["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `${base}.${ext}`),
);
/** Vitest's defaults (vitest.dev/config/include, /exclude), the part that names paths. */
const DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];

function listTestFiles(root: AbsolutePath, tracked: readonly string[]): TestFiles {
  const listed = withStatusStore(root, {}, ({ store }) => {
    const id = worktreeIdFor(root);
    const rows = store.testFileKeys.list(id);
    if (rows.length === 0) return null;
    // Row 005-80: both counts are per project and file; `paths` is not (it printed `-55`).
    const verdict = readVerdict(store, id);
    const paths = [...new Set(rows.map((row) => row.testFile.path))].sort();
    return { paths, current: verdict.byClass.current, runs: verdict.testFiles };
  });
  if (listed !== null && "paths" in listed) {
    return { source: "store", ...listed };
  }
  const config = VITEST_CONFIGS.map((name) => readText(join(root, name))).find((t) => t !== null);
  const include = config == null ? [] : stringArrays(config, "include");
  const exclude = config == null ? [] : stringArrays(config, "exclude");
  const included = matcher(include.length > 0 ? include : DEFAULT_INCLUDE);
  const excluded = matcher([...exclude, ...DEFAULT_EXCLUDE]);
  // Policy `vitest.exclude` drops files as the adapter does (task 004-81); the store's rows
  // already lack them.
  const notCovered = createInputMatcher(loadPolicy(root).policy.vitest.exclude);
  return {
    source: include.length > 0 ? "config-text" : "default",
    paths: tracked.filter((path) => included(path) && !excluded(path) && !notCovered(path)),
    current: null,
    runs: null,
  };
}

/** Every string literal of every `<key>: [...]` array in `text`. */
function stringArrays(text: string, key: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`, "g"))) {
    for (const literal of (match[1] as string).matchAll(/(["'`])([^"'`]*)\1/g)) {
      out.push(literal[2] as string);
    }
  }
  return out;
}

/** Globs as Vitest reads them, `?(x)` extglobs widened to `{,x}`. */
function matcher(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs.flatMap((glob) => {
    try {
      const widened = glob.replace(
        /\?\(([^)]*)\)/g,
        (_, x: string) => `{,${x.replaceAll("|", ",")}}`,
      );
      return [globToRegExp(widened)];
    } catch {
      return [];
    }
  });
  return (path) => patterns.some((pattern) => pattern.test(path));
}

/** True when `dir` exists under the root. */
export function dirExists(root: AbsolutePath, dir: string): boolean {
  return existsSync(join(root, dir));
}
