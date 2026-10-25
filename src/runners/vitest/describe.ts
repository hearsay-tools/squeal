import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { vitestDetected } from "../../core/daemon/runner.js";
import { isRecord } from "../../core/fs/index.js";
import { excludedFilesText } from "../../core/text.js";
import type { AbsolutePath, TestFileRef } from "../../core/types/index.js";
import type { Listing, RunnerDescription, ShellWords } from "../descriptions.js";

/** `vitest run` or `npx vitest run`, recognized by 005 D8 step 1. */
export interface VitestCommand {
  readonly runner: "vitest";
  /** Vitest's filename filters, as written; none runs every test file. */
  readonly filters: readonly string[];
}

/** What the primer says of Vitest (task 001-234). */
export interface VitestCoverage {
  /**
   * Whether the daemon builds a Vitest runner here, by its own rule (spec 003
   * D7): Vitest detected at the root, or no node:test or pytest project
   * configured.
   */
  readonly vitest: boolean;
  /** The config file Vitest finds at the root, as Vitest looks for it; `null` without one. */
  readonly vitestConfig: string | null;
  /**
   * Policy `vitest.excludeProjects` while Vitest is built: projects Squeal
   * never runs (001 D11, task 001-349). Absent or empty: none.
   */
  readonly vitestExcluded?: readonly string[];
  /**
   * Policy `vitest.exclude` while Vitest is built: test-file globs Squeal
   * never lists or runs (004 D7, task 004-81). Absent or empty: none.
   */
  readonly vitestExcludedFiles?: readonly string[];
}

/** What recognizing a Vitest command reads besides the command: the root `package.json`'s scripts. */
export interface VitestContext {
  readonly scripts: Readonly<Record<string, string>>;
}

/** A Vitest-only repository whose root is not read yet: what `PRIMER` says. */
const UNCONFIGURED: VitestCoverage = { vitest: true, vitestConfig: null };

/** Vitest's own config lookup at the root: these names, in this order, each with these extensions. */
const CONFIG_NAMES = ["vitest.config", "vite.config"];
const CONFIG_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/** Vitest's reporters flag, with its value next or after `=`. */
const REPORTER = "--reporter";
/** `--silent`'s values (Vitest's `silent` option); bare, it takes the next word if it is not a flag. */
const SILENT_VALUES: ReadonlySet<string> = new Set(["true", "false", "yes", "no", "passed-only"]);

/**
 * Vitest as the harness knows it (spec 016 D5). It is the fallback of 003
 * D7, and the primer names it whenever the daemon builds it (spec 003
 * lessons, defect 1: told "Vitest", agents ran node:test themselves; review
 * wave 13aa, B1: a node:test-only repository is never told Vitest is
 * covered). Its commands are recognized from the worktree root only.
 */
export const VITEST = {
  runner: "vitest",
  name: "Vitest",
  fallback: true,
  unconfigured: UNCONFIGURED,
  projects: () => [],
  coverage({ policy, root, configured }): VitestCoverage {
    const vitest = !configured || vitestDetected(root);
    return {
      vitest,
      vitestConfig: vitest ? configFile(root) : null,
      vitestExcluded: vitest ? policy.vitest.excludeProjects : [],
      vitestExcludedFiles: vitest ? policy.vitest.exclude : [],
    };
  },
  built: (coverage) => coverage.vitest,
  covered: (coverage) => ({
    config: coverage.vitestConfig,
    excludedProjects: coverage.vitestExcluded ?? [],
  }),
  // Spec 004 D8 as amended 2026-10-18 (task 004-81): the `vitest.exclude` globs, named.
  excluded(coverage) {
    const globs = coverage.vitestExcludedFiles ?? [];
    return globs.length === 0 ? null : excludedFilesText(globs);
  },
  context: (_policy, root, cwd): VitestContext => ({
    scripts: cwd === root ? rootScripts(root) : {},
  }),
  command: (words, context, split) =>
    context.atRoot === false ? null : (vitestCommand(words) ?? npmCommand(words, context, split)),
  // 004 D7: a file `vitest.exclude` drops is one a bare Vitest command still runs; read live, so
  // an exclusion added since the last listing counts too (review 004 wave-12 B2).
  resolves: (live) => live.vitest.exclude.length === 0,
  files: (command, listing) => (command.runner === "vitest" ? vitestFiles(command, listing) : null),
  slowProjects: () => [],
} satisfies RunnerDescription;

/**
 * `vitest run` or `npx vitest run`, then filters and only `--silent` and
 * `--reporter`. A filter with a line number (`file.test.ts:12`) narrows to
 * tests, as `-t` does, and falls through.
 */
function vitestCommand(words: readonly string[]): VitestCommand | null {
  const start = words[0] === "npx" ? 1 : 0;
  if (words[start] !== "vitest" || words[start + 1] !== "run") return null;
  const filters: string[] = [];
  const rest = words.slice(start + 2);
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] as string;
    if (word === "--silent") {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        if (!SILENT_VALUES.has(next)) return null;
        i++;
      }
    } else if (word.startsWith("--silent=")) {
      if (!SILENT_VALUES.has(word.slice("--silent=".length))) return null;
    } else if (word === REPORTER) {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) return null;
      i++;
    } else if (word.startsWith(`${REPORTER}=`)) {
      if (word === `${REPORTER}=`) return null;
    } else if (word.startsWith("-") || word === "" || /:\d+(-\d+)?$/.test(word)) {
      return null;
    } else {
      filters.push(word);
    }
  }
  return { runner: "vitest", filters };
}

/**
 * `npm test` or `npm run <script>` with no arguments, when the root
 * `package.json` script is exactly one Vitest form and has no `pre` or
 * `post` script beside it, which npm would run too.
 */
function npmCommand(
  words: readonly string[],
  { scripts }: VitestContext,
  split: ShellWords,
): VitestCommand | null {
  if (words[0] !== "npm") return null;
  const name =
    words.length === 2 && words[1] === "test"
      ? "test"
      : words.length === 3 && words[1] === "run"
        ? words[2]
        : undefined;
  if (name === undefined) return null;
  if (!Object.hasOwn(scripts, name)) return null;
  if (Object.hasOwn(scripts, `pre${name}`) || Object.hasOwn(scripts, `post${name}`)) return null;
  const script = split(scripts[name] as string);
  return script === null ? null : vitestCommand(script);
}

/**
 * Spec 005 D8 step 2 for Vitest: the listing's files outside every
 * configured project, only while they make one project. The store keeps no
 * project's own directory, which Vitest's filter rule is relative to, so a
 * second project could have one other than the root. Nor while the listing
 * left a file out (task 005-26): the command would run it, and its path is
 * not known to match a filter against.
 */
function vitestFiles(command: VitestCommand, listing: Listing): readonly TestFileRef[] | null {
  const { root, configured } = listing;
  if (listing.omitted !== 0) return null;
  const vitest = listing.files.filter((ref) => !configured.has(ref.project));
  if (new Set(vitest.map((ref) => ref.project)).size !== 1) return null;
  if (command.filters.length === 0) return vitest;
  const selected = new Set<TestFileRef>();
  for (const filter of command.filters) {
    const hits = vitest.filter((ref) => matchesFilter(join(root, ref.path), filter, root));
    if (hits.length === 0) return null;
    for (const ref of hits) selected.add(ref);
  }
  return vitest.filter((ref) => selected.has(ref));
}

/**
 * Vitest's filename filter rule (`TestProject.filterFiles`), with the
 * project's directory and the process's working directory both `root`: a
 * filter matches a test file whose path relative to the directory contains
 * it, or contains the filter taken relative to the directory, ignoring case;
 * an absolute filter also matches every file under it.
 */
function matchesFilter(file: AbsolutePath, filter: string, root: AbsolutePath): boolean {
  if (isAbsolute(filter) && file.startsWith(filter)) return true;
  const testFile = relative(root, file).toLocaleLowerCase();
  const rel = relative(root, resolve(root, filter));
  const relativePath = filter.endsWith("/") ? join(rel, "/") : rel;
  return (
    testFile.includes(filter.toLocaleLowerCase()) ||
    testFile.includes(relativePath.toLocaleLowerCase())
  );
}

/** The root `package.json`'s scripts; none when it is missing or unreadable. */
function rootScripts(root: string): Readonly<Record<string, string>> {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(([, text]) => typeof text === "string"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The config file Vitest finds at `root`, or `null`. */
function configFile(root: string): string | null {
  for (const name of CONFIG_NAMES) {
    for (const extension of CONFIG_EXTENSIONS) {
      if (existsSync(join(root, `${name}${extension}`))) return `${name}${extension}`;
    }
  }
  return null;
}
