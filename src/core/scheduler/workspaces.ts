import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { compare, isMissing, isRecord } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/** How deep a `**` workspace pattern looks below its prefix. */
const MAX_GLOBSTAR_DEPTH = 4;

/** The `package.json` in `dir`, parsed; `null` when missing or not JSON. */
export async function readManifest(dir: AbsolutePath): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** A `dependencies`, `devDependencies` or `optionalDependencies` field that is not empty. */
export function declaresOwnDependencies(manifest: unknown): boolean {
  return isRecord(manifest) && DEPENDENCY_FIELDS.some((field) => nonEmpty(manifest[field]));
}

/** The `workspaces` patterns of a manifest, from the array or from `workspaces.packages`. */
export function workspacePatterns(manifest: unknown): string[] {
  if (!isRecord(manifest)) return [];
  const field = manifest.workspaces;
  const patterns = isRecord(field) ? field.packages : field;
  return Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === "string") : [];
}

function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

/**
 * The workspace directories `patterns` select below `root`, sorted: each one
 * holds a `package.json`. Segments are literal names, `*` and `?` within a
 * name, or `**` for up to `MAX_GLOBSTAR_DEPTH` directories; a `!` pattern
 * removes what it selects. `node_modules` and dot directories are never
 * entered, as npm and Yarn skip them.
 */
export async function expandWorkspaces(
  root: AbsolutePath,
  patterns: readonly string[],
): Promise<RelativePath[]> {
  const selected = new Set<RelativePath>();
  for (const pattern of patterns.filter((p) => !p.startsWith("!"))) {
    for (const dir of await match(root, "", segments(pattern))) selected.add(dir);
  }
  for (const pattern of patterns.filter((p) => p.startsWith("!"))) {
    for (const dir of await match(root, "", segments(pattern.slice(1)))) selected.delete(dir);
  }
  const workspaces: RelativePath[] = [];
  for (const dir of selected) {
    if ((await readManifest(join(root, dir))) !== null) workspaces.push(dir);
  }
  return workspaces.sort(compare);
}

function segments(pattern: string): string[] {
  return pattern.split("/").filter((s) => s !== "" && s !== ".");
}

async function match(root: AbsolutePath, dir: RelativePath, rest: readonly string[]) {
  const [head, ...tail] = rest;
  if (head === undefined) return dir === "" ? [] : [dir];
  if (head === "**") return globstar(root, dir, tail, MAX_GLOBSTAR_DEPTH);
  if (!/[*?]/.test(head)) return match(root, join(dir, head), tail);
  const pattern = new RegExp(
    `^${head
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  );
  const found: RelativePath[] = [];
  for (const name of await subdirectories(join(root, dir))) {
    if (pattern.test(name)) found.push(...(await match(root, join(dir, name), tail)));
  }
  return found;
}

async function globstar(
  root: AbsolutePath,
  dir: RelativePath,
  rest: readonly string[],
  depth: number,
): Promise<RelativePath[]> {
  const found = await match(root, dir, rest);
  if (depth === 0) return found;
  for (const name of await subdirectories(join(root, dir))) {
    found.push(...(await globstar(root, join(dir, name), rest, depth - 1)));
  }
  return found;
}

async function subdirectories(dir: AbsolutePath): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return [];
    throw error;
  }
}
