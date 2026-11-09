import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvironmentDescriptor } from "../keys/environment-descriptor.js";
import type { ExportSource } from "../store/imports.js";
import type { AbsolutePath, EpochMs, ProjectName, RelativePath } from "../types/common.js";
import type { ObservedInputs } from "../types/runner.js";

/*
 * Spec 018 D8 (row 018-16): what `squeal ci record` writes, one part file per
 * Vitest process, for `squeal ci export` (D9, row 018-17) to read. JSON, one
 * object, `format: "squeal-ci-part/1"`. No key is in it: the export job
 * computes keys in a fresh checkout of the same commit. Never in it: failure
 * text, run logs, environment or config values (only their hashes),
 * absolute paths.
 */

export const PART_FORMAT = "squeal-ci-part/1";

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

export interface PartHeader {
  readonly squealVersion: string;
  readonly keyFormat: number;
  readonly runner: "vitest";
  readonly runnerVersion: string;
  /** `HEAD` of the checkout the command ran in; `null` before the first commit. */
  readonly commit: string | null;
  readonly dirty: boolean;
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
}

export interface Part {
  readonly format: typeof PART_FORMAT;
  readonly header: PartHeader;
  readonly projects: readonly PartProject[];
  /** Sorted by project, then path. */
  readonly testFiles: readonly PartFile[];
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
  return value as Part;
}
