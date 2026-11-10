import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoverageRecord, CoverageSource } from "../code/coverage/types.js";
import { configFieldHash, type EnvironmentDescriptor } from "../keys/environment-descriptor.js";
import type { ExportSource } from "../store/imports.js";
import type { AbsolutePath, EpochMs, ProjectName, RelativePath } from "../types/common.js";
import type { ObservedInputs } from "../types/runner.js";
import type { InputEvidence } from "./inputs.js";

/*
 * Spec 018 D8 (row 018-16): what `squeal ci record` writes, one part file per
 * Vitest process, for `squeal ci export` (D9, row 018-17) to read. JSON, one
 * object, `format: "squeal-ci-part/3"`. No key is in it: the export job
 * computes keys in a fresh checkout of the same commit, and keys a file only
 * when the evidence the run took as it read each input is that checkout's
 * content (D9 as amended 2026-11-09, reviews of 0.1.421). Never in it:
 * failure text, run logs, environment or config values (only their hashes),
 * absolute paths. Format 2 added the shard, the snapshot options per field
 * and the shared check names; format 3 the read-time evidence, in place of
 * format 2's input hashes after the run and checkout state; format 4 (spec
 * 020 D13, row 020-08a) Squeal's coverage provider in the run and each test
 * file's coverage record, or why it has none. A format 3 part reads as a
 * part with no records. A part may also hold what recording cost (row
 * 018-29, `RecordingCost`), which no key, export or refusal reads.
 */

export const PART_FORMAT = "squeal-ci-part/4";

/** The formats `readPart` reads: this one, and format 3, which holds no record. */
export const PART_FORMATS = ["squeal-ci-part/3", PART_FORMAT] as const;

export type PartFormat = (typeof PART_FORMATS)[number];

/** The file name prefix of a part; the rest is a UUID, so parts of every shard can share one directory. */
export const PART_PREFIX = "squeal-part-";

/**
 * How the Vitest process's run ended. `completed`: the run ended and no
 * error stood outside a test file. `crashed`: an error outside every test
 * file, so nothing in the run is trusted. `interrupted`: the run was
 * cancelled (a signal, `bail`), so a cancelled test reads as skipped. A part
 * that did not complete lists no test file.
 */
export type PartEnd = "completed" | "crashed" | "interrupted";

/** The run's `--shard`; `1/1` for a run without one. */
export interface PartShard {
  readonly index: number;
  readonly count: number;
}

export interface PartHeader {
  readonly squealVersion: string;
  readonly keyFormat: number;
  readonly runner: "vitest";
  readonly runnerVersion: string;
  /** `HEAD` of the checkout the command ran in; `null` before the first commit. */
  readonly commit: string | null;
  /** Provenance: git status reported any change, untracked files included. */
  readonly dirty: boolean;
  readonly shard: PartShard;
  readonly createdAt: EpochMs;
  /** As the export header records it (spec 018 D2). */
  readonly source: ExportSource;
  readonly end: PartEnd;
  /** The recorder ran in the run's workers: each file's `observed` is what it read. */
  readonly observing: boolean;
  /** Format 4: whether the run had Squeal's coverage provider. Absent in format 3: no record. */
  readonly coverage?: PartCoverage;
  /** Row 018-29: what recording cost the command; absent in a part of an older Squeal. */
  readonly cost?: RecordingCost;
}

/**
 * Row 018-29 (spec 018 D8): what recording cost one `squeal ci record`
 * command, so each run states it. Every part of the command holds the same.
 * Informational: no key, export or refusal reads it.
 */
export interface RecordingCost {
  /** A random ID of the command, which its parts share, so a reader counts it once. */
  readonly command: string;
  /**
   * Time inside Squeal's hooks (`clock.cjs`), summed over the command's
   * processes and threads, in ms: the evidence, the hook's reporter and the
   * coverage provider's work in the Vitest process and its records' worker.
   */
  readonly hooksMs: number;
  /** The processes and threads that reported a time. */
  readonly threads: number;
  /** `ci record`'s own time after the command, reading what the hooks wrote, before writing the parts, in ms. */
  readonly afterMs: number;
}

/**
 * Spec 020 D13: Squeal's provider was in the run, with the versions its
 * records were made at, or why `ci record` did not add it. `note` on the
 * first form names an error that cost records after it was added.
 */
export type PartCoverage =
  | {
      readonly provider: "squeal";
      readonly providerVersion: number;
      readonly recordVersion: number;
      readonly note?: string;
    }
  | { readonly off: CoverageOff; readonly note: string };

/**
 * `project-coverage`: the run's resolved config has `coverage.enabled`, and
 * a Vitest run takes one provider. `no-provider`: this Squeal or the run's
 * Node cannot give it. `failed`: an error of `ci record`'s own.
 */
export type CoverageOff = "project-coverage" | "no-provider" | "failed";

/**
 * Why a test file of a run with the provider has no record (D13.1), in this
 * order when several hold. `inspector`: a file its worker ran imports
 * `node:inspector`, so its tests could see V8 coverage. `filtered`: a test
 * name, tag, line or id filter ran part of it. `not-whole`: its worker ran
 * other test files too. `isolate-false`: its project runs with `isolate:
 * false`, where the provider takes none. `unmapped`: no payload, or one
 * that could not be mapped.
 */
export type NoRecord = "inspector" | "filtered" | "not-whole" | "isolate-false" | "unmapped";

/**
 * Format 4: the part's coverage records, each source entry stored once.
 * A record is its `sources` (indices into `sources`, sorted by path) and
 * its `unread` paths: `CoverageRecord` without its sources inline.
 */
export interface PartRecords {
  readonly sources: readonly CoverageSource[];
  readonly records: readonly {
    readonly sources: readonly number[];
    readonly unread: readonly RelativePath[];
  }[];
}

/**
 * Spec 018 D1's descriptor of one project as the run had it. `config` holds
 * the hash of each top-level field of the run's own resolved config, not
 * Squeal's options (so the `CI` fields of D10 show), and `env` the
 * allow-listed variables the Vitest process saw. The two parts the export
 * job reads from its own checkout of the same commit are left out:
 * `installedDependencies` and `files`.
 */
export type RunDescriptor = Omit<EnvironmentDescriptor, "installedDependencies" | "files">;

export interface PartProject {
  readonly descriptor: RunDescriptor;
  /** The run's `snapshotOptions.updateSnapshot`: D9 takes a part only with `none`. */
  readonly updateSnapshot: string;
  /** Each other field of the run's resolved `snapshotOptions`, hashed (`snapshotFields`): D9 compares them. */
  readonly snapshotOptions: Readonly<Record<string, string>>;
}

/** Observed reads of one test file: `ObservedInputs` without its file. */
export type PartObserved = Omit<ObservedInputs, "testFile">;

export interface PartCheck {
  /** Unique in its file, as Squeal names a check (`checkNames`). */
  readonly fullName: string;
  readonly outcome: "pass" | "fail" | "skip";
  readonly durationMs: number;
  readonly location: { readonly line: number; readonly column: number } | null;
}

export interface PartFile {
  readonly project: ProjectName;
  readonly path: RelativePath;
  /**
   * `fail` when the module failed, any check failed, or an error stood at
   * file or suite level or named the file outside a test; `skip` when the
   * module was skipped; `pass` otherwise.
   */
  readonly outcome: "pass" | "fail" | "skip";
  /** The module's own duration; `null` when Vitest reports none. */
  readonly durationMs: number | null;
  readonly checks: readonly PartCheck[];
  /** Absent: the recorder saw no read, or did not run (`PartHeader.observing`). */
  readonly observed?: PartObserved;
  /**
   * Full names two or more of the file's checks share. Without the run's
   * test locations the part cannot name them as the daemon does, so D9
   * leaves the file out. Absent: none.
   */
  readonly sharedNames?: readonly string[];
  /** Format 4: its record, an index into `Part.coverage.records`. */
  readonly record?: number;
  /** Format 4, with the provider in the run: why the file has no record. */
  readonly noRecord?: NoRecord;
}

export interface Part {
  /** `PART_FORMAT` as written; format 3 as read. */
  readonly format: PartFormat;
  readonly header: PartHeader;
  readonly projects: readonly PartProject[];
  /** Sorted by project, then path. */
  readonly testFiles: readonly PartFile[];
  /**
   * What the command's processes read, listed or probed, each at the moment
   * it did (`readEvidence`): a file's git blob id, `null` for no file, a
   * listing path's names hash. A path written during the command, or read
   * with two contents, is not here. Every part of one command holds the same.
   */
  readonly evidence: InputEvidence;
  /** Format 4: the records `PartFile.record` names; absent when none was made. */
  readonly coverage?: PartRecords;
}

/** The field of `snapshotOptions` D9 asks to be `none` and compares no further. */
const UPDATE_SNAPSHOT = "updateSnapshot";

/**
 * Each field of the resolved `snapshotOptions` in `resolvedConfig`, a
 * runner's canonical config JSON, hashed as a descriptor hashes a config
 * field, `updateSnapshot` aside (D9; review of 0.1.421 B2): `snapshotFormat`
 * and every other option change what a snapshot assertion compares.
 * Options that are not an object hash as one field, `(snapshotOptions)`.
 */
export function snapshotFields(resolvedConfig: string): Record<string, string> {
  let options: unknown;
  try {
    options = (JSON.parse(resolvedConfig) as { snapshotOptions?: unknown } | null)?.snapshotOptions;
  } catch {
    options = resolvedConfig;
  }
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return { "(snapshotOptions)": configFieldHash(options ?? null) };
  }
  return Object.fromEntries(
    Object.entries(options)
      .filter(([name]) => name !== UPDATE_SNAPSHOT)
      .map(([name, value]) => [name, configFieldHash(value)]),
  );
}

/** Writes `part` into `dir` under a new name; returns the file. */
export function writePart(dir: AbsolutePath, part: Part): AbsolutePath {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${PART_PREFIX}${randomUUID()}.json`);
  writeFileSync(file, `${JSON.stringify(part)}\n`);
  return file;
}

/** The part in `file`, or why it is not one. */
export function readPart(file: AbsolutePath): Part | string {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return `${file}: not a JSON file (${error instanceof Error ? error.message : String(error)})`;
  }
  if (typeof value !== "object" || value === null) return `${file}: not a part`;
  const format = (value as { format?: unknown }).format;
  if (!PART_FORMATS.some((known) => known === format)) {
    const known = PART_FORMATS.map((f) => JSON.stringify(f)).join(" or ");
    return `${file}: format ${JSON.stringify(format)}, not ${known}`;
  }
  const part = value as Partial<Part>;
  if (!Array.isArray(part.projects) || !Array.isArray(part.testFiles) || !part.header) {
    return `${file}: a part without header, projects or testFiles`;
  }
  if (typeof part.evidence !== "object" || part.evidence === null) {
    return `${file}: a part without evidence`;
  }
  return value as Part;
}

/**
 * The coverage record of `file` in `part`, as the daemon and the gate hold
 * one (`buildRecord`); `null` when the part holds none for it, or names one
 * it does not hold.
 */
export function partRecord(part: Part, file: PartFile): CoverageRecord | null {
  const record = file.record === undefined ? undefined : part.coverage?.records[file.record];
  if (record === undefined || part.coverage === undefined) return null;
  const sources: CoverageSource[] = [];
  for (const at of record.sources) {
    const source = part.coverage.sources[at];
    if (source === undefined) return null;
    sources.push(source);
  }
  return { v: 1, sources, unread: record.unread };
}
