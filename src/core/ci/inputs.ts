import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { compare } from "../fs/compare.js";
import { ABSENT_LISTING, GIT_ENTRY, namesHash } from "../keys/observed.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";

/*
 * Spec 018 D8 and D9 (2026-11-09, review of 0.1.421 second round B1, "one
 * owner for input evidence"): the evidence that ties a shard's results to
 * content. While `squeal ci record` runs the command, every process records
 * the content of each input at the moment it read it, a listing's names at
 * the moment it listed, a path's absence at the moment it probed, and each
 * path it wrote (`src/runners/vitest/ci-runtime/evidence.cjs`). `squeal ci
 * export` keys a file only when every input of its closure has such
 * evidence, none of it cancelled by a write, equal to the export's checkout.
 * Nothing is hashed after the command, and neither a clean checkout nor a
 * path git did not report stands for evidence.
 */

/** Per input path the run read, listed or probed: a file's blob id (`null`: none), a listing path's names hash. */
export type InputEvidence = Readonly<Record<RelativePath, FileHash | null>>;

/** The names `directory` holds on disk, hashed; a marker when it is absent. */
export function listingHash(root: AbsolutePath, directory: RelativePath): FileHash {
  try {
    return namesHash(readdirSync(join(root, directory)));
  } catch {
    return ABSENT_LISTING;
  }
}

/** The worktree's `.git` by its kind, as a key holds it (`gitEntryByKind`); `null` when absent. */
export function gitEntryHash(root: AbsolutePath): FileHash | null {
  const entry = statSync(join(root, GIT_ENTRY), { throwIfNoEntry: false });
  if (entry === undefined) return null;
  const kind = entry.isDirectory() ? "directory" : "file";
  return createHash("sha1").update(`.git ${kind}`).digest("hex");
}

interface EvidenceLine {
  readonly e?: Record<string, unknown>;
  readonly w?: readonly unknown[];
  readonly t?: readonly unknown[];
}

/**
 * The command's evidence from the files `evidence.cjs` appended to `dir`,
 * one per process and thread: each path's one value. A path with two values
 * (it changed while the run read it), or written, or below a path written
 * with everything below it, has none. Sorted by path. A line that does not
 * parse is skipped; the evidence in it is lost, which only leaves files out.
 */
export function readEvidence(dir: AbsolutePath): InputEvidence {
  const values = new Map<RelativePath, FileHash | null>();
  const conflicting = new Set<RelativePath>();
  const written = new Set<RelativePath>();
  const trees = new Set<RelativePath>();
  for (const line of evidenceLines(dir)) {
    for (const [path, value] of Object.entries(line.e ?? {})) {
      if (typeof value !== "string" && value !== null) continue;
      const known = values.get(path);
      if (known === undefined) values.set(path, value);
      else if (known !== value) conflicting.add(path);
    }
    for (const path of line.w ?? []) if (typeof path === "string") written.add(path);
    for (const path of line.t ?? []) if (typeof path === "string") trees.add(path);
  }
  const below = writtenBelow(trees);
  const kept = [...values].filter(
    ([path]) => !conflicting.has(path) && !written.has(path) && !below(path),
  );
  return Object.fromEntries(kept.sort(([a], [b]) => compare(a, b)));
}

function evidenceLines(dir: AbsolutePath): EvidenceLine[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort(compare);
  } catch {
    return [];
  }
  const lines: EvidenceLine[] = [];
  for (const name of names) {
    for (const text of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (text === "") continue;
      try {
        const value: unknown = JSON.parse(text);
        if (typeof value === "object" && value !== null) lines.push(value as EvidenceLine);
      } catch {
        // a line cut short by a process stopped mid-write
      }
    }
  }
  return lines;
}

/** Whether a path, a file or a listing path, is one of `trees` or below one. */
function writtenBelow(trees: ReadonlySet<RelativePath>): (path: RelativePath) => boolean {
  // `""`: the root, every path below it (a process withheld the whole run).
  if (trees.has("")) return () => true;
  return (path) => {
    const bare = path.endsWith("/") ? path.slice(0, -1) : path;
    if (trees.has(bare)) return true;
    for (let at = bare.indexOf("/"); at >= 0; at = bare.indexOf("/", at + 1)) {
      if (trees.has(bare.slice(0, at))) return true;
    }
    return false;
  };
}

/**
 * Spec 018 D9: the inputs among `paths`, a keyed file's closure, the shard's
 * `evidence` does not certify at `here` (this checkout's content, as its key
 * holds it; `undefined` unknown). Certified: the run's read-time evidence
 * holds the path and equals `here`. Empty: the file's result is of this
 * content.
 */
export function uncertified(
  paths: readonly RelativePath[],
  evidence: InputEvidence,
  here: (path: RelativePath) => FileHash | null | undefined,
): RelativePath[] {
  return paths.filter((path) => {
    if (!Object.hasOwn(evidence, path)) return true;
    const now = here(path);
    return now === undefined || evidence[path] !== now;
  });
}
