import { COVERAGE_PROVIDER_VERSION, COVERAGE_RECORD_VERSION } from "../code/coverage/record.js";
import { compare } from "../fs/compare.js";
import { testFileId } from "../keys/reverse-index.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { FileHash, TestFileRef } from "../types/keys.js";
import type { RunnerClosure } from "../types/runner.js";
import type { NamedPart } from "./export-check.js";
import { type Uncertified, uncertifiedWhy } from "./inputs.js";
import { knownCollector, type Part, type PartFile, partRecord } from "./parts.js";

/*
 * Spec 020 D13.2 and 018 D9 (row 020-52): whether a part's evidence of one
 * test file stands for a run of it here, and why not. One owner for both
 * readers of parts, `squeal code --base --parts` (`code/gate/parts.ts`)
 * and `squeal ci export` (`export.ts`, `export-check.ts`,
 * `export-inputs.ts`): reviews 0.1.427 B1 and 0.1.427-r2 B1 came from a
 * rule one reader had and the other lacked. `FileReuse` makes each reason
 * of D13.2, one step at a time in the order the gate checks them; a reader
 * reads what a step needs (the runner's environments and closures, the
 * content here) between steps, in batches. The `environment` step asks the
 * run rule both readers apply, `reuseRefusal` (`export-check.ts`). Where
 * the readers differ on purpose, a named option (`ReuseOptions`) or a
 * named question (`firstShared`) says so; the 020-52 notes list them.
 */

/**
 * Why a part did not give a selected file it holds, in the order the steps
 * check them: `duplicate`, more than one part holds it; `unusable`, its
 * part gives no evidence; `environment`, its part ran its project in
 * another environment; `closure`, the runner gives no closure of it here;
 * `input`, the part does not certify an input of its closure or of what it
 * read; `record`, it passed and the part holds no record of it; `unread`,
 * its record could not read a changed path; `source`, its record holds
 * other bytes of a source.
 */
export type ReuseReason =
  | "duplicate"
  | "unusable"
  | "environment"
  | "closure"
  | "input"
  | "record"
  | "unread"
  | "source";

/** One selected file a part holds and did not give, as the gate's report gives it (D7). */
export interface FileRefusal {
  /** The part's file name; with `duplicate`, the first by name. */
  readonly part: string;
  readonly reason: ReuseReason;
  /** `input`, `unread`, `source`: the first path, by name, that refused it. */
  readonly input?: RelativePath;
  /**
   * What the reason alone does not say: the other parts (`duplicate`), the
   * part's or environment's difference (`unusable`, `environment`), how
   * the input differs and how many do (`input`), why the part holds no
   * record (`record`). Absent when the reason says it all.
   */
  readonly detail?: string;
}

/** A part that holds a test file: the part's file name, the part, and its entry of the file. */
export interface Holder {
  readonly name: string;
  readonly part: Part;
  readonly file: PartFile;
}

/**
 * Why a part's run of `project` is no evidence here, `reuseRefusal` at the
 * reader's place; `null` when it is.
 */
export type RunCheck = (named: NamedPart, project: ProjectName) => string | null;

/**
 * The content of a path here as its key holds it (`hereOf`): `null` none,
 * `undefined` unknown. Option of the reader: the gate hashes the bytes on
 * disk, `ci export` reads its job's stat cache.
 */
export type Content = (
  path: RelativePath,
) => FileHash | null | undefined | Promise<FileHash | null | undefined>;

/** A file the evidence step did not give: its refusal and, for `input`, every input not certified. */
export interface EvidenceRefusal {
  readonly refusal: FileRefusal;
  /** The inputs not certified, in the order given; empty unless the reason is `input`. */
  readonly uncertified: readonly RelativePath[];
}

/** Where the readers differ on purpose in a step both take. */
export interface ReuseOptions {
  /**
   * The gate's: its evidence of a file is a coverage record as well as a
   * result (D13.1). A part whose records this Squeal does not read gives
   * no file (`unusable`); a passed file with no record (`record`), or whose
   * record could not read a changed path (`unread`) or holds other bytes of
   * a source (`source`), is not given. A failed file is given with no
   * record: its failure makes the verdict incomplete whatever a run would
   * add (D5). Absent for `ci export`, which carries no records (D13.3,
   * D19.5): a part gives a file by its run and its inputs alone.
   */
  readonly records?: RecordsOption;
}

export interface RecordsOption {
  /** The changed paths: a record that names one of them `unread` does not give its file. */
  readonly changed: readonly RelativePath[];
  /** D12.1: `coverage.children` at the base; `ci record` collects no child process's coverage. */
  readonly children: boolean;
}

/** The `unusable` reason of every part while `coverage.children` is on at the base. */
const CHILDREN =
  "coverage.children is on at the base, and ci record collects no child process's coverage";

/** How an input differs, as an `input` refusal tells it. */
const INPUT_DIFFERS: Readonly<Record<Uncertified, string>> = {
  unrecorded: "its part holds no evidence of it",
  unknown: "its content here is not known",
  differs: "its part read other content",
};

/** Whether parts give a selected test file, step by step (D13.2), under `options`. */
export class FileReuse {
  /** With `records`: each part that gives no evidence, and why, in the parts' order. */
  readonly unusable: readonly { readonly name: string; readonly why: string }[];
  readonly #holders = new Map<string, Holder[]>();
  readonly #unusableBy: ReadonlyMap<string, string>;
  readonly #records: RecordsOption | undefined;

  constructor(parts: readonly NamedPart[], options: ReuseOptions = {}) {
    for (const { file: name, part } of parts) {
      for (const file of part.testFiles) {
        const id = testFileId(file);
        this.#holders.set(id, [...(this.#holders.get(id) ?? []), { name, part, file }]);
      }
    }
    const records = options.records;
    this.#records = records;
    this.unusable = parts.flatMap(({ file: name, part }) => {
      const why = records === undefined ? null : records.children ? CHILDREN : partUnusable(part);
      return why === null ? [] : [{ name, why }];
    });
    this.#unusableBy = new Map(this.unusable.map(({ name, why }) => [name, why]));
  }

  /**
   * Steps `duplicate` and `unusable`: the one part that may give `ref`, or
   * why none does; `null` when no part holds it. Two parts that hold it are
   * two runs of it, so neither gives it.
   */
  owner(ref: TestFileRef): Holder | FileRefusal | null {
    const [only, ...more] = this.#holders.get(testFileId(ref)) ?? [];
    if (only === undefined) return null;
    if (more.length > 0) {
      const [first, ...others] = [only, ...more].map((o) => o.name).sort(compare);
      return {
        part: first ?? only.name,
        reason: "duplicate",
        detail: `also in ${others.join(", ")}`,
      };
    }
    const why = this.#unusableBy.get(only.name);
    return why === undefined ? only : { part: only.name, reason: "unusable", detail: why };
  }

  /** Step `environment`: `holder`'s part's run of `project` is no evidence here, by `check`. */
  environment(holder: Holder, project: ProjectName, check: RunCheck): FileRefusal | null {
    const differs = check({ file: holder.name, part: holder.part }, project);
    return differs === null ? null : { part: holder.name, reason: "environment", detail: differs };
  }

  /** Step `closure`: the runner's closure of the file here, or why the part does not give it: none. */
  closure(holder: Holder, closure: RunnerClosure | null): RunnerClosure | FileRefusal {
    return closure ?? { part: holder.name, reason: "closure" };
  }

  /**
   * Steps `input`, then with `records` `record`, `unread` and `source`:
   * why `holder`'s part does not give its file with `inputs`, the inputs of
   * its closure here and of what it read, at `here`; `null` when it does.
   * An input is certified when the part's read-time evidence holds it and
   * equals its content here (018 D9); `here` is read only for an input the
   * evidence holds, and for a record's sources.
   */
  async evidence(
    holder: Holder,
    inputs: readonly RelativePath[],
    here: Content,
  ): Promise<EvidenceRefusal | null> {
    const { name, part } = holder;
    const contents = new Map<RelativePath, FileHash | null | undefined>();
    for (const path of inputs) {
      if (Object.hasOwn(part.evidence, path)) contents.set(path, await here(path));
    }
    const differ = uncertifiedWhy(inputs, part.evidence, (path) => contents.get(path));
    const [first] = [...differ].sort((a, b) => compare(a.path, b.path));
    if (first !== undefined) {
      const more = differ.length > 1 ? `; ${differ.length - 1} more inputs` : "";
      const detail = `${INPUT_DIFFERS[first.why]}${more}`;
      const refusal: FileRefusal = { part: name, reason: "input", input: first.path, detail };
      return { refusal, uncertified: differ.map((d) => d.path) };
    }
    if (this.#records === undefined) return null;
    const refusal = await recordRefusal(holder, this.#records.changed, here);
    return refusal === null ? null : { refusal, uncertified: [] };
  }
}

/**
 * Spec 018 D9: the first test file, in the parts' order, that a part holds
 * after an earlier part held it, with the two parts' names. `ci export`
 * refuses the whole set by it, since the shards overlapped and the union
 * would pass for the whole suite; the gate refuses only that file
 * (`FileReuse.owner`, `duplicate`).
 */
export function firstShared(
  parts: readonly NamedPart[],
): { readonly file: PartFile; readonly first: string; readonly second: string } | null {
  const seen = new Map<string, string>();
  for (const { file: name, part } of parts) {
    for (const file of part.testFiles) {
      const id = testFileId(file);
      const first = seen.get(id);
      if (first !== undefined) return { file, first, second: name };
      seen.set(id, name);
    }
  }
  return null;
}

/**
 * Why a part's files give no coverage evidence here; `null` when they may.
 * Whether its runs are evidence at all is `reuseRefusal`'s, per project.
 */
export function partUnusable(part: Part): string | null {
  const { coverage, observing } = part.header;
  if (coverage === undefined) return `${part.format} holds no coverage record`;
  if ("off" in coverage) return `ci record added no coverage provider (${coverage.off})`;
  if (!knownCollector(coverage.collector)) {
    const by = JSON.stringify(coverage.collector);
    return `its records were collected by ${by}, which this Squeal does not read`;
  }
  const { providerVersion, recordVersion } = coverage;
  if (providerVersion !== COVERAGE_PROVIDER_VERSION || recordVersion !== COVERAGE_RECORD_VERSION) {
    const made = `provider ${providerVersion}, record ${recordVersion}`;
    const now = `${COVERAGE_PROVIDER_VERSION}, ${COVERAGE_RECORD_VERSION}`;
    return `its records were made at ${made}; this Squeal's are ${now}`;
  }
  if (!observing) return "its run did not record what its tests read";
  return null;
}

/** Steps `record`, `unread` and `source` of `holder`'s file. */
async function recordRefusal(
  { name, part, file }: Holder,
  changed: readonly RelativePath[],
  here: Content,
): Promise<FileRefusal | null> {
  const failed = file.outcome === "fail" || file.checks.some((c) => c.outcome === "fail");
  const record = partRecord(part, file);
  if (record === null) {
    if (failed) return null;
    const detail = file.noRecord === undefined ? {} : { detail: file.noRecord };
    return { part: name, reason: "record", ...detail };
  }
  const [unread] = record.unread.filter((path) => changed.includes(path)).sort(compare);
  if (unread !== undefined) return { part: name, reason: "unread", input: unread };
  for (const source of [...record.sources].sort((a, b) => compare(a.path, b.path))) {
    if ((await here(source.path)) !== source.blob) {
      return { part: name, reason: "source", input: source.path };
    }
  }
  return null;
}
