import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NamedPart } from "../../ci/export-check.js";
import { gitEntryHash, listingHash, uncertified } from "../../ci/inputs.js";
import {
  PART_PREFIX,
  type Part,
  type PartFile,
  type PartObserved,
  partRecord,
  readPart,
} from "../../ci/parts.js";
import { compare } from "../../fs/compare.js";
import { runGit, splitNul } from "../../fs/git.js";
import type { ObjectFormat } from "../../hash/blob.js";
import { hashFile } from "../../hash/blob.js";
import { readObjectFormat } from "../../hash/git-index.js";
import { GIT_ENTRY, listedDirectory, listingPath } from "../../keys/observed.js";
import { testFileId } from "../../keys/reverse-index.js";
import { scratchOf } from "../../scheduler/observed.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { FileHash, TestFileRef } from "../../types/keys.js";
import type { RunnerClosure } from "../../types/runner.js";
import { checkIgnored } from "../../watcher/git.js";
import { COVERAGE_PROVIDER_VERSION, COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import { FILE_ERROR, type StoredEvidence } from "./collect.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D13.2 (row 020-08b): `squeal code --base --parts <dir>...` takes
 * a selected test file's evidence from `squeal ci record`'s parts instead of
 * running it (research `ci-evidence.md` Q3, rule 3). A file is taken when it
 * is in exactly one part; that part's run had Squeal's provider at this
 * Squeal's provider and record versions and recorded what its tests read;
 * the part's read-time evidence certifies the content here of every input
 * of the file's closure and of what it read (`uncertified`, as `ci export`
 * certifies, 018 D9); and its record's sources are the bytes here. A file
 * with no record is taken only when it failed: its failure makes the
 * verdict incomplete whatever a run would add (D5). Every other file runs.
 * The parts are only read.
 */

export interface PartsOptions {
  readonly root: AbsolutePath;
  readonly parts: readonly NamedPart[];
  /** The changed paths: a record that names one of them `unread` is not taken. */
  readonly changed: readonly RelativePath[];
  /**
   * D12.1: `coverage.children` at the base. `ci record` collects no child
   * process's coverage, so with it on no record is taken.
   */
  readonly children: boolean;
  /** Why parts give no evidence, told once per reason. */
  readonly note?: (text: string) => void;
}

/**
 * The parts in each of `dirs`, by file name; or why they cannot be read, a
 * setup error (D1): a directory that is missing or holds no part, or a part
 * that does not read.
 */
export function readPartsIn(dirs: readonly AbsolutePath[]): NamedPart[] | string {
  const parts: NamedPart[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) return `no directory ${dir}`;
    const names = readdirSync(dir).filter((n) => n.startsWith(PART_PREFIX) && n.endsWith(".json"));
    if (names.length === 0) return `no part (${PART_PREFIX}*.json) in ${dir}`;
    for (const name of names.sort(compare)) {
      const file = join(dir, name);
      const part = readPart(file);
      if (typeof part === "string") return part;
      parts.push({ file, part });
    }
  }
  return parts;
}

/** Why a part's files give no evidence here; `null` when they may. */
export function unusable(part: Part): string | null {
  const { coverage, end, observing } = part.header;
  if (end !== "completed") return `its run did not complete (${end})`;
  if (coverage === undefined) return `${part.format} holds no coverage record`;
  if ("off" in coverage) return `ci record added no coverage provider (${coverage.off})`;
  const { providerVersion, recordVersion } = coverage;
  if (providerVersion !== COVERAGE_PROVIDER_VERSION || recordVersion !== COVERAGE_RECORD_VERSION) {
    const made = `provider ${providerVersion}, record ${recordVersion}`;
    const here = `${COVERAGE_PROVIDER_VERSION}, ${COVERAGE_RECORD_VERSION}`;
    return `its records were made at ${made}; this Squeal's are ${here}`;
  }
  if (!observing) return "its run did not record what its tests read";
  return null;
}

/** `CollectOptions.stored` over `options.parts`: Vitest files only, since `ci record` records Vitest alone. */
export function partsEvidence(options: PartsOptions): StoredEvidence {
  const note = options.note ?? (() => {});
  const owners = new Map<string, { part: Part; file: PartFile }[]>();
  const why = new Map<string, string[]>();
  for (const { file: name, part } of options.parts) {
    for (const file of part.testFiles) {
      const id = testFileId(file);
      owners.set(id, [...(owners.get(id) ?? []), { part, file }]);
    }
    const reason = options.children
      ? "coverage.children is on at the base, and ci record collects no child process's coverage"
      : unusable(part);
    if (reason !== null) why.set(reason, [...(why.get(reason) ?? []), name]);
  }
  for (const [reason, names] of why) {
    const count = names.length === 1 ? "1 part gives" : `${names.length} parts give`;
    const first = `${names[0]}${names.length > 1 ? ", …" : ""}`;
    note(`${count} no evidence, so its test files run: ${reason} (${first})`);
  }
  const unused = new Set([...why.values()].flat());
  const usable = new Set(options.parts.filter((p) => !unused.has(p.file)).map((p) => p.part));
  let here: Promise<Here> | null = null;
  return async (runner, files, closure) => {
    const found = new Map<TestFileRef, TestFileEvidence>();
    if (runner !== "vitest" || usable.size === 0) return found;
    here ??= readObjectFormat(options.root).then((format) => hereOf(options.root, format));
    for (const ref of files) {
      const owned = owners.get(testFileId(ref)) ?? [];
      // A file in two parts, two runs of it, is taken from neither.
      const [only] = owned;
      if (owned.length !== 1 || only === undefined || !usable.has(only.part)) continue;
      const evidence = await taken(options, only, (await closure?.(ref)) ?? null, await here);
      if (evidence !== null) found.set(ref, evidence);
    }
    return found;
  };
}

/** The content of a path here, as a key holds it: `null` none, `undefined` unknown. */
type Here = (path: RelativePath) => Promise<FileHash | null | undefined>;

/**
 * A file's blob id, a listing path's names, `.git` by its kind: as `ci
 * export`'s `certifier` reads them.
 */
function hereOf(root: AbsolutePath, format: ObjectFormat): Here {
  const known = new Map<RelativePath, Promise<FileHash | null | undefined>>();
  return (path) => {
    let hash = known.get(path);
    if (hash === undefined) {
      const directory = listedDirectory(path);
      if (directory !== null) hash = Promise.resolve(listingHash(root, directory));
      else if (path === GIT_ENTRY) hash = Promise.resolve(gitEntryHash(root));
      else hash = hashFile(join(root, path), format).catch(() => undefined);
      known.set(path, hash);
    }
    return hash;
  };
}

/** `file`'s evidence from `part`, or `null` when it must run. */
async function taken(
  options: PartsOptions,
  { part, file }: { part: Part; file: PartFile },
  closure: RunnerClosure | null,
  here: Here,
): Promise<TestFileEvidence | null> {
  if (closure === null) return null;
  const inputs = await inputsOf(options.root, closure, file.observed);
  const contents = new Map<RelativePath, FileHash | null | undefined>();
  for (const path of inputs) contents.set(path, await here(path));
  if (uncertified(inputs, part.evidence, (path) => contents.get(path)).length > 0) return null;
  const failed = failedOf(file);
  const record = partRecord(part, file);
  if (record === null && failed.length === 0) return null;
  if (record !== null) {
    if (record.unread.some((path) => options.changed.includes(path))) return null;
    for (const source of record.sources) {
      if ((await here(source.path)) !== source.blob) return null;
    }
  }
  return {
    runner: "vitest",
    path: file.path,
    // 018 D8: a part lists a file only when its run completed; 015 D8: a record only of a whole run.
    completed: true,
    failed,
    skipped: file.checks.some((c) => c.outcome === "skip") || file.outcome === "skip",
    loads: [...closure.paths].sort(compare),
    record,
    from: "parts",
  };
}

/** Its failed checks' names, or the file-level error when it failed with none. */
function failedOf(file: PartFile): string[] {
  const names = file.checks.filter((c) => c.outcome === "fail").map((c) => c.fullName);
  if (names.length > 0) return [...new Set(names)].sort(compare);
  return file.outcome === "fail" ? [FILE_ERROR] : [];
}

/**
 * The inputs the part must certify: the runner's closure here, and what
 * the file read beyond it, as the daemon's record keys it
 * (`observedGrowth`): each listing, a recursive listing as the listing of
 * each directory below it that holds a tracked file, and none of the
 * run's own scratch, a git-ignored path below a directory it wrote (016
 * D4).
 */
async function inputsOf(
  root: AbsolutePath,
  closure: RunnerClosure,
  observed: PartObserved | undefined,
): Promise<RelativePath[]> {
  const own = new Set(closure.paths);
  if (observed === undefined) return [...own];
  const listed = observed.directories.map(listingPath);
  for (const directory of observed.recursive ?? []) {
    listed.push(...(await listingsBelow(root, directory)));
  }
  const read = [...observed.paths, ...(observed.modules ?? []), ...listed];
  const fresh = [...new Set(read)].filter((path) => !own.has(path));
  const written = observed.written ?? [];
  const bare = (path: RelativePath) => listedDirectory(path) ?? path;
  const ignored =
    written.length === 0
      ? new Set<RelativePath>()
      : await checkIgnored(
          root,
          [...new Set(fresh.map(bare))].filter((p) => p !== ""),
        );
  const scratch = scratchOf(written, ignored);
  return [...own, ...fresh.filter((path) => !scratch(bare(path)))];
}

/** The listing paths of `directory` and of every directory below it that holds a tracked file. */
async function listingsBelow(root: AbsolutePath, directory: RelativePath): Promise<RelativePath[]> {
  const tracked = splitNul(await runGit(root, ["ls-files", "-z", "--", directory || "."]));
  const out = new Set([listingPath(directory)]);
  const floor = directory === "" ? 0 : directory.length;
  for (const path of tracked) {
    for (let at = path.lastIndexOf("/"); at > floor; at = path.lastIndexOf("/", at - 1)) {
      out.add(listingPath(path.slice(0, at)));
    }
  }
  return [...out];
}
