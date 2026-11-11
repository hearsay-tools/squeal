import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NamedPart } from "../../ci/export-check.js";
import { hereOf, inputsOfReadsHere, uncertified } from "../../ci/inputs.js";
import { PART_PREFIX, type Part, type PartFile, partRecord, readPart } from "../../ci/parts.js";
import { compare } from "../../fs/compare.js";
import { hashFile, type ObjectFormat } from "../../hash/blob.js";
import { readObjectFormat } from "../../hash/git-index.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { FileHash, TestFileRef } from "../../types/keys.js";
import type { RunnerClosure } from "../../types/runner.js";
import { COVERAGE_PROVIDER_VERSION, COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import { FILE_ERROR, type StoredEvidence } from "./collect.js";
import { environmentCheck, type GateEnvironment } from "./parts-environment.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D13.2 (row 020-08b): `squeal code --base --parts <dir>...` takes
 * a selected test file's evidence from `squeal ci record`'s parts instead of
 * running it (research `ci-evidence.md` Q3, rule 3). A file is taken when it
 * is in exactly one part; that part's run had Squeal's provider at this
 * Squeal's provider and record versions and recorded what its tests read;
 * the part's run of the file's project is evidence at the gate's runner by
 * `ci export`'s rule (`reuseRefusal` in `parts-environment.ts`; reviews
 * 0.1.427 B1, 0.1.427-r2 B1);
 * the part's read-time evidence certifies the content here of every input
 * of the file's closure and of what it read, as the daemon's record keys
 * them (`inputsOfReads`, row 020-20), each as `ci export` certifies it
 * (`uncertified`, `hereOf`; 018 D9); and its record's sources are the bytes
 * here. A file
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
  /** D13.2: what the gate's environment holds beside its runner's; a part's project must match it. */
  readonly environment: GateEnvironment;
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

/**
 * Why a part's files give no coverage evidence here; `null` when they may.
 * Whether its runs are evidence at all is `reuseRefusal`'s, per project.
 */
export function unusable(part: Part): string | null {
  const { coverage, observing } = part.header;
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
  const owners = new Map<string, Owner[]>();
  const why = new Map<string, string[]>();
  for (const { file: name, part } of options.parts) {
    for (const file of part.testFiles) {
      const id = testFileId(file);
      owners.set(id, [...(owners.get(id) ?? []), { name, part, file }]);
    }
    const reason = options.children
      ? "coverage.children is on at the base, and ci record collects no child process's coverage"
      : unusable(part);
    if (reason !== null) why.set(reason, [...(why.get(reason) ?? []), name]);
  }
  for (const [reason, names] of why) {
    const count = names.length === 1 ? "1 part gives" : `${names.length} parts give`;
    const first = `${names[0]}${names.length > 1 ? ", …" : ""}`;
    options.note?.(`${count} no evidence, so its test files run: ${reason} (${first})`);
  }
  const unused = new Set([...why.values()].flat());
  const usable = new Set(options.parts.filter((p) => !unused.has(p.file)).map((p) => p.part));
  let here: Promise<Here> | null = null;
  const told = new Set<string>();
  const tell = (text: string) => {
    if (!told.has(text)) options.note?.(text);
    told.add(text);
  };
  return async (runner, files, closure, environment) => {
    const found = new Map<TestFileRef, TestFileEvidence>();
    if (runner !== "vitest" || usable.size === 0) return found;
    const certify = await environmentCheck(environment, options.environment);
    const candidates: Candidate[] = [];
    for (const ref of files) {
      const owned = owners.get(testFileId(ref)) ?? [];
      // A file in two parts, two runs of it, is taken from neither.
      const [only] = owned;
      if (owned.length !== 1 || only === undefined || !usable.has(only.part)) continue;
      const differs = certify({ file: only.name, part: only.part }, ref.project);
      if (differs !== null) {
        const project = JSON.stringify(ref.project);
        tell(
          `${only.name} gives no evidence of project ${project}, so its test files run: ${differs}`,
        );
        continue;
      }
      const loaded = (await closure?.(ref)) ?? null;
      if (loaded !== null) candidates.push({ ref, owner: only, closure: loaded });
    }
    if (candidates.length === 0) return found;
    here ??= readObjectFormat(options.root).then((format) => contentHere(options.root, format));
    const inputs = await inputsOf(options.root, candidates);
    for (const [at, candidate] of candidates.entries()) {
      const evidence = await taken(options, candidate, inputs[at] ?? [], await here);
      if (evidence !== null) found.set(candidate.ref, evidence);
    }
    return found;
  };
}

/** A test file in a part, and the part's file name. */
interface Owner {
  readonly name: string;
  readonly part: Part;
  readonly file: PartFile;
}

/** A selected test file the part may give, and its closure here. */
interface Candidate {
  readonly ref: TestFileRef;
  readonly owner: Owner;
  readonly closure: RunnerClosure;
}

/** The content of a path here, as a key holds it: `null` none, `undefined` unknown. */
type Here = (path: RelativePath) => Promise<FileHash | null | undefined>;

/** `hereOf` with a file's blob id from its bytes on disk, each path read once. */
function contentHere(root: AbsolutePath, format: ObjectFormat): Here {
  const of = hereOf(root, (path) => hashFile(join(root, path), format).catch(() => undefined));
  const known = new Map<RelativePath, Promise<FileHash | null | undefined>>();
  return (path) => {
    let hash = known.get(path);
    if (hash === undefined) {
      hash = Promise.resolve(of(path));
      known.set(path, hash);
    }
    return hash;
  };
}

/**
 * The inputs each candidate's part must certify: its closure here, and what
 * the file read beyond it, as the daemon's record keys it (`inputsOfReads`).
 */
async function inputsOf(
  root: AbsolutePath,
  candidates: readonly Candidate[],
): Promise<RelativePath[][]> {
  const reads = candidates.map(({ owner, closure }) => ({
    closure: new Set(closure.paths),
    observed: owner.file.observed ?? { paths: [], directories: [] },
  }));
  const inputs = await inputsOfReadsHere(root, reads);
  return candidates.map(({ closure }, at) => [...new Set(closure.paths), ...(inputs[at] ?? [])]);
}

/** `owner`'s file's evidence from its part, or `null` when it must run. */
async function taken(
  options: PartsOptions,
  { owner: { part, file }, closure }: Candidate,
  inputs: readonly RelativePath[],
  here: Here,
): Promise<TestFileEvidence | null> {
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
