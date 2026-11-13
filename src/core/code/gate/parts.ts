import { join } from "node:path";
import type { NamedPart } from "../../ci/export-check.js";
import { hereOf, inputsOfReadsHere } from "../../ci/inputs.js";
import { type PartFile, partRecord } from "../../ci/parts.js";
import { FileReuse, type Holder } from "../../ci/reuse.js";
import { compare } from "../../fs/compare.js";
import { hashFile, type ObjectFormat } from "../../hash/blob.js";
import { readObjectFormat } from "../../hash/git-index.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { FileHash, TestFileRef } from "../../types/keys.js";
import type { RunnerClosure } from "../../types/runner.js";
import type { StoredEvidence } from "./collect.js";
import { FILE_ERROR } from "./evidence.js";
import { environmentCheck, type GateEnvironment } from "./parts-environment.js";
import type { GatePartRefusal, PartRefusal } from "./parts-refused.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D13.2 (row 020-08b): `squeal code --base --parts <dir>...` takes
 * a selected test file's evidence from `squeal ci record`'s parts instead of
 * running it (research `ci-evidence.md` Q3, rule 3). Whether a part gives a
 * file, and why not, is `FileReuse`'s (`ci/reuse.ts`, row 020-52), the rule
 * `ci export` applies too, with the gate's option `records`: a file is
 * taken when it is in exactly one part; that part's run had Squeal's
 * provider, or the project's V8 provider whose payloads Squeal read
 * (D19.5), at this Squeal's provider and record versions and recorded what
 * its tests read; the part's run of the file's project is evidence at the
 * gate's runner by `ci export`'s rule (`reuseRefusal`, through
 * `parts-environment.ts`; reviews 0.1.427 B1, 0.1.427-r2 B1); the part's
 * read-time evidence certifies the content here of every input of the
 * file's closure and of what it read, as the daemon's record keys them
 * (`inputsOfReads`, row 020-20; 018 D9); and its record's sources are the
 * bytes here. A file with no record is taken only when it failed: its
 * failure makes the verdict incomplete whatever a run would add (D5).
 * Every other file runs. This file reads what the steps need, in batches:
 * the runner's environments, each file's closure, the inputs of what it
 * read, the bytes on disk. The parts are only read.
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
  /** Row 020-49 (#205): each selected file a part holds and does not give, and why. */
  readonly refused?: (refusal: PartRefusal) => void;
}

/** `CollectOptions.stored` over `options.parts`: Vitest files only, since `ci record` records Vitest alone. */
export function partsEvidence(options: PartsOptions): StoredEvidence {
  const records = { changed: options.changed, children: options.children };
  const reuse = new FileReuse(options.parts, { records });
  const why = new Map<string, string[]>();
  for (const { name, why: reason } of reuse.unusable) {
    why.set(reason, [...(why.get(reason) ?? []), name]);
  }
  for (const [reason, names] of why) {
    const count = names.length === 1 ? "1 part gives" : `${names.length} parts give`;
    const first = `${names[0]}${names.length > 1 ? ", …" : ""}`;
    options.note?.(`${count} no evidence, so its test files run: ${reason} (${first})`);
  }
  let here: Promise<Here> | null = null;
  const told = new Set<string>();
  const tell = (text: string) => {
    if (!told.has(text)) options.note?.(text);
    told.add(text);
  };
  return async (runner, files, closure, environment) => {
    const found = new Map<TestFileRef, TestFileEvidence>();
    if (runner !== "vitest") return found;
    const refuse = (ref: TestFileRef, refusal: GatePartRefusal) =>
      options.refused?.({ runner, path: ref.path, ...refusal });
    const single: { readonly ref: TestFileRef; readonly owner: Holder }[] = [];
    for (const ref of files) {
      const owner = reuse.owner(ref);
      if (owner === null) continue;
      if ("reason" in owner) refuse(ref, owner);
      else single.push({ ref, owner });
    }
    if (single.length === 0) return found;
    const certify = await environmentCheck(environment, options.environment);
    const candidates: Candidate[] = [];
    for (const { ref, owner } of single) {
      const differs = reuse.environment(owner, ref.project, certify);
      if (differs !== null) {
        const project = JSON.stringify(ref.project);
        tell(
          `${owner.name} gives no evidence of project ${project}, so its test files run: ${differs.detail}`,
        );
        refuse(ref, differs);
        continue;
      }
      const loaded = reuse.closure(owner, (await closure?.(ref)) ?? null);
      if ("reason" in loaded) refuse(ref, loaded);
      else candidates.push({ ref, owner, closure: loaded });
    }
    if (candidates.length === 0) return found;
    here ??= readObjectFormat(options.root).then((format) => contentHere(options.root, format));
    const inputs = await inputsOf(options.root, candidates);
    for (const [at, candidate] of candidates.entries()) {
      const refused = await reuse.evidence(candidate.owner, inputs[at] ?? [], await here);
      if (refused !== null) refuse(candidate.ref, refused.refusal);
      else found.set(candidate.ref, given(candidate));
    }
    return found;
  };
}

/** A selected test file the part may give, and its closure here. */
interface Candidate {
  readonly ref: TestFileRef;
  readonly owner: Holder;
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

/** The evidence `FileReuse.evidence` let `candidate`'s part give of its file. */
function given({ owner: { part, file }, closure }: Candidate): TestFileEvidence {
  return {
    runner: "vitest",
    path: file.path,
    // 018 D8: a part lists a file only when its run completed; 015 D8: a record only of a whole run.
    completed: true,
    failed: failedOf(file),
    skipped: file.checks.some((c) => c.outcome === "skip") || file.outcome === "skip",
    loads: [...closure.paths].sort(compare),
    record: partRecord(part, file),
    from: "parts",
  };
}

/** Its failed checks' names, or the file-level error when it failed with none. */
function failedOf(file: PartFile): string[] {
  const names = file.checks.filter((c) => c.outcome === "fail").map((c) => c.fullName);
  if (names.length > 0) return [...new Set(names)].sort(compare);
  return file.outcome === "fail" ? [FILE_ERROR] : [];
}
