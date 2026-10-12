import { join, posix } from "node:path";
import { isRecord } from "../../core/fs/index.js";
import type { ArtifactCandidate, Evidence } from "./plan.js";
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
 * Spec 005 D3, "Slow tests and their inputs", step 2: directories a slow
 * group may test, each with its evidence. Leads from 005-04: never ranked by
 * how much evidence a candidate has, `files` entries are weak evidence, and
 * a gitignored candidate that does not exist is "not built in this worktree".
 */

type Found = { readonly path: string } & Evidence;

const FIELDS = ["bin", "main", "module", "exports", "files"] as const;

export async function artifactCandidates(
  facts: RepoFacts,
  dir: string,
  files: readonly string[],
): Promise<ArtifactCandidate[]> {
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
 * Gitignored directories, those that exist and those the rules above name
 * even when absent, that a string literal in the group's test files names,
 * as whole path segments relative to the group's package.
 */
async function namedCandidates(
  facts: RepoFacts,
  manifest: Manifest,
  files: readonly string[],
  found: readonly Found[],
): Promise<Found[]> {
  const ignored = new Set([
    ...(await existingIgnoredDirs(facts.root)),
    ...(await ignoredDirs(facts.root, [...new Set(found.map((f) => f.path))])),
  ]);
  const texts = files.map((file) => readText(join(facts.root, file)) ?? "");
  const out: Found[] = [];
  for (const dir of [...ignored].sort()) {
    if (manifest.dir !== "" && !dir.startsWith(`${manifest.dir}/`)) continue;
    const tail = posix.relative(manifest.dir || ".", dir);
    const literal = new RegExp(
      `(['"\`])[^'"\`\\n]*(?<![\\w.-])${tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])[^'"\`\\n]*\\1`,
    );
    const hits = texts.map((t) => literal.exec(t)?.[0]).filter((h) => h !== undefined);
    if (hits.length === 0) continue;
    out.push({
      path: dir,
      rule: "named",
      detail: `gitignored, named by ${hits.length} of ${files.length} test files, such as ${hits[0]}`,
      weak: false,
    });
  }
  return out;
}

/**
 * Whether input glob `glob` lies in or over directory `dir`, judged by its
 * directory part before the first wildcard: `plugins/claude-code/**` holds
 * `plugins`, `dist` holds `dist`, and `**` holds everything.
 */
export function holdsArtifact(glob: string, dir: string): boolean {
  const clean = glob.replace(/^\.\//, "");
  const stem = clean.split(/[*?[{]/)[0] as string;
  const base =
    stem.length < clean.length
      ? stem.slice(0, stem.lastIndexOf("/") + 1)
      : `${stem.replace(/\/+$/, "")}/`;
  if (base === "") return clean.startsWith("**");
  return base.startsWith(`${dir}/`) || `${dir}/`.startsWith(base);
}
