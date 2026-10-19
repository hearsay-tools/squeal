import { join, posix } from "node:path";
import { isRecord } from "../../core/fs/index.js";
import {
  dirExists,
  existingIgnoredDirs,
  ignoredDirs,
  type Manifest,
  nearestManifest,
  type RepoFacts,
  readJson,
  readText,
  scriptsOf,
} from "./repo.js";

/*
 * Build-output evidence, spec 005 D3 "Slow tests and build-output tests"
 * step 2: the directories a group of test files may test, each with its
 * evidence. A group whose tests name one that is gitignored or a build
 * script writes is an exclude candidate (row 005-70, `testsBuildOutput`).
 * Leads from 005-04: never ranked by how much evidence a candidate has,
 * `files` entries are weak evidence, and a gitignored candidate that does
 * not exist is "not built in this worktree".
 */

/** A directory a group of test files may test, with its evidence. */
export interface BuildOutputCandidate {
  readonly path: string;
  readonly exists: boolean;
  readonly ignored: boolean;
  readonly evidence: readonly Evidence[];
}

export interface Evidence {
  readonly rule: "bin" | "main" | "module" | "exports" | "files" | "build-script" | "named";
  readonly detail: string;
  /** D3 leads from 005-04: `files` lists sources beside artifacts. */
  readonly weak: boolean;
}

type Found = { readonly path: string } & Evidence;

const FIELDS = ["bin", "main", "module", "exports", "files"] as const;

/** The build outputs the test `files` of directory `dir` may test, sorted by path. */
export async function buildOutputCandidates(
  facts: RepoFacts,
  dir: string,
  files: readonly string[],
): Promise<BuildOutputCandidate[]> {
  const manifest = nearestManifest(facts, dir);
  const found = [...fieldCandidates(manifest), ...buildCandidates(facts, manifest)];
  const named = await namedCandidates(facts, manifest, files, found);
  const all = [...found, ...named];
  const ignored = new Set(await ignoredDirs(facts.root, [...new Set(all.map((f) => f.path))]));
  const byPath = new Map<string, Evidence[]>();
  for (const { path, ...evidence } of all) {
    const list = byPath.get(path) ?? [];
    if (!list.some((e) => e.detail === evidence.detail)) list.push(evidence);
    byPath.set(path, list);
  }
  return [...byPath]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, evidence]) => ({
      path,
      exists: dirExists(facts.root, path),
      ignored: ignored.has(path),
      evidence,
    }));
}

/**
 * Whether the group's tests name `c` and it is a build output: gitignored or
 * written by a build script. A manifest field alone is not enough, since
 * `main` and `bin` can name sources (`lib/index.js`) the tests may name too.
 */
export function testsBuildOutput(c: BuildOutputCandidate): boolean {
  const rules = new Set(c.evidence.map((e) => e.rule));
  return rules.has("named") && (c.ignored || rules.has("build-script"));
}

/** The directories the manifest's `bin`, `main`, `module`, `exports` and `files` name. */
function fieldCandidates(manifest: Manifest): Found[] {
  const where = `${manifest.dir || "."}/package.json`;
  const found: Found[] = [];
  for (const rule of FIELDS) {
    for (const value of strings(manifest.value[rule])) {
      const clean = value.replace(/^\.\//, "").replace(/\/+$/, "");
      // A path names its top directory; a `files` entry names itself unless it is a file.
      const parts = clean.split("/");
      const dir =
        rule === "files"
          ? /\.\w+$/.test(clean) || /[*?{[]/.test(clean)
            ? null
            : clean
          : parts.length > 1
            ? (parts[0] as string)
            : null;
      if (dir === null || dir === "" || dir === "..") continue;
      found.push({
        path: posix.join(manifest.dir, dir),
        rule,
        detail: `${where} ${rule} "${value}"`,
        weak: rule === "files",
      });
    }
  }
  return found;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isRecord(value)) return Object.values(value).flatMap(strings);
  return [];
}

/** The output directory of each build script: `tsc` with its tsconfig's `outDir`, or `--outDir`, `--outdir`, `-o`. */
function buildCandidates(facts: RepoFacts, manifest: Manifest): Found[] {
  const found: Found[] = [];
  for (const [name, text] of scriptsOf(manifest)) {
    if (!/^(pre|post)?build(:|$)/.test(name)) continue;
    for (const part of text.split(/&&|;|\|\|/)) {
      const words = part.trim().split(/\s+/);
      const flag = words.findIndex((w) => ["--outDir", "--outdir", "-o"].includes(w));
      // Root-relative: a flag's path is the script's package's, `outDir` its tsconfig's.
      let out = flag === -1 ? null : posix.join(manifest.dir, words[flag + 1] ?? "");
      if (flag === -1 && words[0] === "tsc") {
        const project = words.findIndex((w) => w === "-p" || w === "--project");
        const tsconfig = project === -1 ? "tsconfig.json" : (words[project + 1] ?? "tsconfig.json");
        out = outDir(facts, posix.join(manifest.dir, tsconfig), 0);
      }
      if (out === null || out === "." || out === "") continue;
      const path = out.replace(/\/+$/, "");
      found.push({
        path,
        rule: "build-script",
        detail: `build script ${manifest.dir || "."}:${name} (${part.trim()}) writes ${path}`,
        weak: false,
      });
    }
  }
  return found;
}

/** A tsconfig's `outDir`, relative to the root, following relative `extends`. */
function outDir(facts: RepoFacts, tsconfig: string, depth: number): string | null {
  const path = tsconfig.endsWith(".json") ? tsconfig : posix.join(tsconfig, "tsconfig.json");
  const text = readText(join(facts.root, path));
  if (text === null || depth > 4) return null;
  const parsed = readJson(join(facts.root, path));
  const options = isRecord(parsed) ? parsed.compilerOptions : null;
  const dir = isRecord(options) && typeof options.outDir === "string" ? options.outDir : null;
  // JSON with comments does not parse; its `outDir` is still read as text.
  const value = dir ?? /"outDir"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;
  if (value !== null) return posix.join(posix.dirname(path), value);
  const extended = /"extends"\s*:\s*"(\.[^"]+)"/.exec(text)?.[1];
  return extended === undefined
    ? null
    : outDir(facts, posix.join(posix.dirname(path), extended), depth + 1);
}

/**
 * The candidates a string literal in the group's test files names: gitignored
 * directories, those that exist and those the rules above name even when
 * absent, and the rules' other directories (005-38, so a tracked one such as
 * `plugins` here can be named too). A string names a directory only when, read
 * relative to the test file, its package or the root, it is a path under it;
 * and not when it ends a tracked file's path outside it, as
 * `dist/cli/squeal.mjs` ends `plugins/codex/dist/cli/squeal.mjs` here, unless
 * it is explicitly relative and the test file's own directory resolves it
 * (005-42 B2: `../../dist/cli/squeal.mjs` from `test/e2e` names root `dist`).
 */
async function namedCandidates(
  facts: RepoFacts,
  manifest: Manifest,
  files: readonly string[],
  found: readonly Found[],
): Promise<Found[]> {
  const literals = files.map((file) => ({ file, strings: stringLiterals(facts, file) }));
  const ignored = new Set([
    ...(await existingIgnoredDirs(facts.root)),
    ...(await ignoredDirs(facts.root, [...new Set(found.map((f) => f.path))])),
    ...(await ignoredAncestors(facts, manifest.dir, literals)),
  ]);
  const inPackage = [...ignored].filter(
    (dir) => manifest.dir === "" || dir.startsWith(`${manifest.dir}/`),
  );
  const out: Found[] = [];
  for (const dir of [...new Set([...inPackage, ...found.map((f) => f.path)])].sort()) {
    const hits = literals.flatMap(({ file, strings }) => {
      const hit = strings.find((s) => names(facts, posix.dirname(file), manifest.dir, s, dir));
      return hit === undefined ? [] : [hit];
    });
    if (hits.length === 0) continue;
    const named = `named by ${hits.length} of ${files.length} test files, such as "${hits[0]}"`;
    out.push({
      path: dir,
      rule: "named",
      detail: ignored.has(dir) ? `gitignored, ${named}` : named,
      weak: false,
    });
  }
  return out;
}

/**
 * Row 005-70: the existing directories a gitignore rule names above a path
 * the strings read, the shallowest per path, though git tracks them: a bundle
 * committed past its `dist/` rule, as `plugins/codex/dist` here, is a build
 * output by the repository's own rule.
 */
async function ignoredAncestors(
  facts: RepoFacts,
  pkg: string,
  literals: readonly { readonly file: string; readonly strings: readonly string[] }[],
): Promise<string[]> {
  const chains = new Set<string>();
  for (const { file, strings } of literals) {
    for (const s of strings) {
      if (!s.includes("/") || s.startsWith("/") || s.includes("${")) continue;
      const bases = /^\.\.?\//.test(s) ? [posix.dirname(file)] : [posix.dirname(file), pkg, ""];
      for (const base of bases) {
        const path = posix.join(base, s);
        if (!path.startsWith("../")) chains.add(posix.dirname(path));
      }
    }
  }
  const dirs = new Set<string>();
  for (const chain of chains) {
    const parts = chain.split("/");
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const existing = [...dirs].filter(
    (d) => d !== "." && !/(^|\/)(node_modules|\.git)(\/|$)/.test(d) && dirExists(facts.root, d),
  );
  const ignored = new Set(await ignoredDirs(facts.root, existing));
  // The shallowest: `plugins/codex/dist`, not also `plugins/codex/dist/cli`.
  return [...ignored].filter(
    (d) => !d.split("/").some((_, i, p) => i > 0 && ignored.has(p.slice(0, i).join("/"))),
  );
}

/** The contents of a file's quoted strings, each up to its first blank. */
function stringLiterals(facts: RepoFacts, file: string): string[] {
  const text = readText(join(facts.root, file)) ?? "";
  return [...text.matchAll(/(['"`])([^'"`\n]*)\1/g)].map(
    (m) => (m[2] as string).split(/\s/)[0] as string,
  );
}

/** Whether string `s` is a path under `dir` read from test directory `from`, package `pkg` or the root. */
function names(facts: RepoFacts, from: string, pkg: string, s: string, dir: string): boolean {
  if (s === "" || s.startsWith("/") || s.includes("${")) return false;
  const under = (base: string) => posix.join(base, s).startsWith(`${dir}/`);
  if (/^\.\.?\//.test(s) && under(from)) return true;
  if (![from, pkg, ""].some(under)) return false;
  const tail = s.replace(/^(\.\.?\/)+/, "");
  return !facts.tracked.some(
    (file) => !file.startsWith(`${dir}/`) && (file === tail || file.endsWith(`/${tail}`)),
  );
}
