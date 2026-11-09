import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
 * format 2's input hashes after the run and checkout state.
 */

export const PART_FORMAT = "squeal-ci-part/3";

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
}

export interface Part {
  readonly format: typeof PART_FORMAT;
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
  if (format !== PART_FORMAT) {
    return `${file}: format ${JSON.stringify(format)}, not ${JSON.stringify(PART_FORMAT)}`;
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
