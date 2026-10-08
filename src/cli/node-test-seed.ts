import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compiles } from "../core/daemon/policy-node-test.js";
import { isMissing, isRecord } from "../core/fs/index.js";
import { globToRegExp } from "../core/keys/glob.js";
import type { NodeTestProject } from "../core/types/index.js";

/*
 * Spec 003 D1: "`squeal init` seeds entries from `package.json` scripts of
 * the exact form `node [flags...] --test <globs...>`, one entry per script,
 * named after the script; any other form prints a template and a note."
 */

/** A `nodeTest` entry as written: `env` is left to its default. */
export type SeededProject = Pick<NodeTestProject, "name" | "cwd" | "argv" | "include">;

/** What `squeal init` writes under `nodeTest` and prints beside it. */
export interface NodeTestSeed {
  readonly projects: readonly SeededProject[];
  /** One line per seeded or refused script, and per manifest that cannot be read. */
  readonly notes: readonly string[];
  /** An entry to fill in by hand for each script that mentions `--test` but was refused. */
  readonly templates: readonly SeededProject[];
}

/** The root `package.json` and those of its `workspaces` packages. */
export function seedNodeTest(root: string): NodeTestSeed {
  const notes: string[] = [];
  const found: { dir: string; script: string; parsed: ParsedScript | string }[] = [];
  const rootManifest = readManifest(root, "", notes);
  for (const dir of ["", ...workspaceDirs(root, rootManifest)]) {
    const manifest = dir === "" ? rootManifest : readManifest(root, dir, notes);
    const scripts = isRecord(manifest) && isRecord(manifest.scripts) ? manifest.scripts : {};
    for (const [script, text] of Object.entries(scripts)) {
      if (typeof text !== "string") continue;
      const parsed = parseTestScript(text);
      if (parsed !== null) found.push({ dir, script, parsed });
    }
  }

  // Names are unique (D1); a script seeded from several packages is named by its package
  // too. Only seeded scripts count for a seeded name (review wave 2, N1): a refused one
  // is never written; its printed template is renamed apart by `uniqueNames`.
  const all = new Map<string, number>();
  const seeded = new Map<string, number>();
  for (const { script, parsed } of found) {
    all.set(script, (all.get(script) ?? 0) + 1);
    if (typeof parsed !== "string") seeded.set(script, (seeded.get(script) ?? 0) + 1);
  }
  const projects: SeededProject[] = [];
  const templates: SeededProject[] = [];
  for (const { dir, script, parsed } of found) {
    const counts = typeof parsed === "string" ? all : seeded;
    const name = dir !== "" && (counts.get(script) ?? 0) > 1 ? `${dir}:${script}` : script;
    const where = manifestPath(dir);
    const cwd = dir === "" ? {} : { cwd: dir };
    if (typeof parsed === "string") {
      notes.push(
        `script "${script}" in ${where} is not \`node [flags...] --test <globs...>\` (${parsed}); add its nodeTest entry by hand from the template below`,
      );
      templates.push({ name, ...cwd, argv: [], include: ["<test-file glob>"] });
    } else {
      notes.push(`seeded nodeTest project "${name}" from ${where}`);
      projects.push({ name, ...cwd, argv: parsed.argv, include: parsed.include });
    }
  }
  return { projects, notes, templates: uniqueNames(templates, projects) };
}

/**
 * `templates` renamed so none repeats a seeded or an earlier template's name
 * (lessons, defect 7: a refused root `test:unit` beside a seeded package's
 * `test:unit`): a taken name gets its package, `root` for the root, then a
 * number.
 */
function uniqueNames(
  templates: readonly SeededProject[],
  projects: readonly SeededProject[],
): SeededProject[] {
  const taken = new Set(projects.map((project) => project.name));
  return templates.map((template) => {
    const base = taken.has(template.name)
      ? `${template.cwd ?? "root"}:${template.name}`
      : template.name;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return { ...template, name };
  });
}

export interface ParsedScript {
  readonly argv: readonly string[];
  readonly include: readonly string[];
}

/** Node flags whose value may follow as the next word, so it is not taken for a script. */
const VALUE_FLAGS = new Set([
  "--import",
  "--require",
  "-r",
  "--loader",
  "--experimental-loader",
  "--conditions",
  "-C",
  "--env-file",
  "--env-file-if-exists",
  "--input-type",
  "--title",
  "--disable-warning",
  "--redirect-warnings",
  "--unhandled-rejections",
  "--experimental-config-file",
  "--watch-path",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-timeout",
  "--test-shard",
  "--test-isolation",
  "--test-global-setup",
  "--test-coverage-include",
  "--test-coverage-exclude",
]);

/**
 * `null` when `text` does not mention `--test`; the flags and globs of
 * `node [flags...] --test <globs...>`; else why it is not that form. Quotes
 * are allowed; anything the shell would act on is refused.
 */
export function parseTestScript(text: string): ParsedScript | string | null {
  if (!/--test(?![\w-])/.test(text)) return null;
  const words = shellWords(text);
  if (typeof words === "string") return words;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) return "an environment assignment";
  if (words[0] !== "node") return "a command other than node";
  const at = words.indexOf("--test");
  if (at === -1) return "no --test of its own";
  const argv = words.slice(1, at);
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (word.startsWith("-")) continue;
    if (!VALUE_FLAGS.has(argv[i - 1] ?? "")) return "a script or argument before --test";
  }
  const include = words.slice(at + 1);
  if (include.length === 0) return "no test-file glob";
  if (include.some((word) => word.startsWith("-"))) return "a flag after --test";
  if (compiles(include) !== null) return "a glob Squeal cannot use";
  return { argv, include };
}

/** The words of `text` with quotes removed, or the first thing a shell would act on. */
function shellWords(text: string): string[] | string {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (/\s/.test(char)) {
      if (word !== null) words.push(word);
      word = null;
    } else if (char === "'" || char === '"') {
      const end = text.indexOf(char, i + 1);
      if (end === -1) return "an unclosed quote";
      const quoted = text.slice(i + 1, end);
      if (char === '"' && /[$`\\]/.test(quoted)) return "a shell expansion";
      word = (word ?? "") + quoted;
      i = end;
    } else {
      const special = SPECIAL[char];
      if (special !== undefined) return special;
      word = (word ?? "") + char;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

const SPECIAL: Readonly<Record<string, string>> = {
  "|": "a pipe",
  "&": "a chain",
  ";": "a chain",
  "(": "a chain",
  ")": "a chain",
  "<": "a redirection",
  ">": "a redirection",
  $: "a shell expansion",
  "`": "a shell expansion",
  "\\": "a shell expansion",
};

function manifestPath(dir: string): string {
  return dir === "" ? "package.json" : `${dir}/package.json`;
}

/** The parsed manifest, `null` when absent; a note when it does not parse. */
function readManifest(root: string, dir: string, notes: string[]): unknown {
  let text: string;
  try {
    text = readFileSync(join(root, dir, "package.json"), "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  let value: unknown = null;
  try {
    value = JSON.parse(text);
  } catch {
    // Reported below like any other non-object.
  }
  if (!isRecord(value)) {
    notes.push(`${manifestPath(dir)} is not a JSON object; no nodeTest project seeded from it`);
  }
  return value;
}

/**
 * Directories of the root's `workspaces` (an array, or `{ packages }`) that
 * hold a `package.json`, sorted. `!` patterns exclude; `node_modules` and
 * dot directories are never entered.
 */
function workspaceDirs(root: string, manifest: unknown): string[] {
  const field = isRecord(manifest) ? manifest.workspaces : undefined;
  const list = isRecord(field) ? field.packages : field;
  if (!Array.isArray(list)) return [];
  const include: Pattern[] = [];
  const exclude: RegExp[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const negated = entry.startsWith("!");
    const glob = (negated ? entry.slice(1) : entry).replace(/^\.\//, "").replace(/\/+$/, "");
    try {
      if (negated) exclude.push(globToRegExp(glob));
      else include.push(pattern(glob));
    } catch {
      // A pattern npm would reject names no package here.
    }
  }
  const dirs: string[] = [];
  const walk = (dir: string, depth: number): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      const reachable = include.filter((p) => depth < p.depth && overlaps(path, p.prefix));
      if (reachable.length === 0) continue;
      const listed =
        reachable.some((p) => p.regexp.test(path)) && !exclude.some((p) => p.test(path));
      if (listed && hasManifest(root, path)) dirs.push(path);
      walk(path, depth + 1);
    }
  };
  walk("", 0);
  return dirs.sort();
}

/** A compiled workspace glob, with how far down a walk can still match it. */
interface Pattern {
  readonly regexp: RegExp;
  /** The leading segments without a wildcard, joined by `/`. */
  readonly prefix: string;
  /** Its segment count, or `Infinity` with `**`. */
  readonly depth: number;
}

function pattern(glob: string): Pattern {
  const segments = glob.split("/");
  const literal = segments.findIndex((segment) => /[*?[{]/.test(segment));
  return {
    regexp: globToRegExp(glob),
    prefix: segments.slice(0, literal === -1 ? segments.length : literal).join("/"),
    depth: segments.includes("**") ? Number.POSITIVE_INFINITY : segments.length,
  };
}

/** True when one of the two paths is the other or lies under it. */
function overlaps(path: string, prefix: string): boolean {
  if (prefix === "") return true;
  return path === prefix || path.startsWith(`${prefix}/`) || prefix.startsWith(`${path}/`);
}

function hasManifest(root: string, dir: string): boolean {
  try {
    return readdirSync(join(root, dir)).includes("package.json");
  } catch {
    return false;
  }
}
