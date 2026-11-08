import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { compare } from "../fs/compare.js";
import type { EnvironmentDescriptor } from "../keys/environment-descriptor.js";
import type { CheckId } from "../types/check.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, EnvironmentHash } from "../types/keys.js";
import { type ExportHeader, isHeader } from "./imports.js";

/*
 * Spec 018 D2: the export file. One gzipped JSON object, `format:
 * "squeal-results/1"`. Never in it: failure text, run logs, environment
 * values, absolute paths, the worktree id, the user, HOME.
 */

export const RESULTS_FORMAT = "squeal-results/1";

/** The three per-file observed maps an export carries. */
export const OBSERVED_MAPS = ["observed", "observedDirect", "observedModules"] as const;
export type ObservedMap = (typeof OBSERVED_MAPS)[number];
export type ObservedEntries = Partial<Record<ObservedMap, readonly RelativePath[]>>;

/** One exported test file: its key, closure list and observed entries. */
export interface ExportedTestFile {
  readonly project: ProjectName;
  readonly path: RelativePath;
  readonly key: CheckKey;
  /** `null` when the store held no closure list for the file. */
  readonly closure: {
    readonly paths: readonly RelativePath[];
    readonly complete: boolean;
    readonly method: string;
  } | null;
  /** The file's entry in each observed map that has one. */
  readonly observed: ObservedEntries;
}

/** One exported result: a pass or skip at its file's key. */
export interface ExportedResult {
  readonly project: ProjectName;
  readonly testPath: RelativePath;
  readonly kind: CheckId["kind"];
  /** The test's full name; `null` for a file or setup check. */
  readonly fullName: string | null;
  readonly location: {
    readonly path: RelativePath;
    readonly line: number;
    readonly column: number;
  } | null;
  readonly key: CheckKey;
  readonly outcome: "pass" | "skip";
  readonly durationMs: number;
}

/** The environment one project's exported keys were computed with. */
export interface ExportedEnvironment {
  readonly project: ProjectName;
  readonly hash: EnvironmentHash;
  readonly descriptor: EnvironmentDescriptor | null;
}

/** One project's start-up paths (`observedStartup`). */
export interface ExportedStartup {
  readonly project: ProjectName;
  readonly paths: readonly RelativePath[];
}

/** The whole export file, before gzip. */
export interface ResultsBundle {
  readonly format: typeof RESULTS_FORMAT;
  readonly header: ExportHeader;
  readonly environments: readonly ExportedEnvironment[];
  readonly testFiles: readonly ExportedTestFile[];
  readonly observedStartup: readonly ExportedStartup[];
  readonly results: readonly ExportedResult[];
}

/** The gzipped file of `bundle`. */
export function encodeBundle(bundle: ResultsBundle): Buffer {
  return gzipSync(JSON.stringify(bundle));
}

/** The bundle in `bytes`, or why it is not one this release reads. */
export function decodeBundle(bytes: Buffer): ResultsBundle | string {
  let value: unknown;
  try {
    value = JSON.parse(gunzipSync(bytes).toString("utf8"));
  } catch {
    return "not a gzipped JSON file";
  }
  return parseBundle(value);
}

/** `value` as a bundle, or why it is not one this release reads. */
export function parseBundle(value: unknown): ResultsBundle | string {
  if (!isObject(value)) return "not a Squeal results export";
  if (value.format !== RESULTS_FORMAT) {
    const format = typeof value.format === "string" ? value.format : "none";
    return `unknown format ${format}; this Squeal reads ${RESULTS_FORMAT}`;
  }
  if (!isHeader(value.header)) return "its header is malformed";
  const parts: readonly [string, (item: unknown) => boolean][] = [
    ["environments", isEnvironment],
    ["testFiles", isTestFile],
    ["observedStartup", isStartup],
    ["results", isResult],
  ];
  for (const [name, check] of parts) {
    const list = value[name];
    if (!Array.isArray(list) || !list.every(check)) return `its ${name} are malformed`;
  }
  return value as unknown as ResultsBundle;
}

/** The hash of a list of paths as an import stores it for D5, order and duplicates aside. */
export function listHash(paths: readonly string[]): string {
  const sorted = [...new Set(paths)].sort(compare);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 32);
}

/** The hash of a file's observed entries as an import stores it for D5. */
export function observedHash(observed: ObservedEntries): string {
  return listHash(OBSERVED_MAPS.flatMap((map) => (observed[map] ?? []).map((p) => `${map}:${p}`)));
}

/** The first path in `bundle` that is not relative to the worktree, or `null`. */
export function absolutePathIn(bundle: ResultsBundle): string | null {
  const paths = [
    ...bundle.testFiles.flatMap((f) => [
      f.path,
      ...(f.closure?.paths ?? []),
      ...Object.values(f.observed).flat(),
    ]),
    ...bundle.observedStartup.flatMap((s) => s.paths),
    ...bundle.results.flatMap((r) => [
      r.testPath,
      ...(r.location === null ? [] : [r.location.path]),
    ]),
    ...bundle.environments.flatMap((e) => (e.descriptor?.files ?? []).map(([path]) => path)),
  ];
  return paths.find((p) => p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isStrings = (value: unknown): boolean =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

function isEnvironment(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.project === "string" &&
    typeof value.hash === "string" &&
    (value.descriptor === null || isObject(value.descriptor))
  );
}

function isTestFile(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.observed)) return false;
  const closure = value.closure;
  return (
    typeof value.project === "string" &&
    typeof value.path === "string" &&
    typeof value.key === "string" &&
    (closure === null ||
      (isObject(closure) &&
        isStrings(closure.paths) &&
        typeof closure.complete === "boolean" &&
        typeof closure.method === "string")) &&
    Object.entries(value.observed).every(
      ([map, paths]) => (OBSERVED_MAPS as readonly string[]).includes(map) && isStrings(paths),
    )
  );
}

function isStartup(value: unknown): boolean {
  return isObject(value) && typeof value.project === "string" && isStrings(value.paths);
}

function isResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  const at = value.location;
  return (
    typeof value.project === "string" &&
    typeof value.testPath === "string" &&
    (value.kind === "test" || value.kind === "file" || value.kind === "setup") &&
    (typeof value.fullName === "string" || (value.fullName === null && value.kind !== "test")) &&
    (at === null ||
      (isObject(at) &&
        typeof at.path === "string" &&
        typeof at.line === "number" &&
        typeof at.column === "number")) &&
    typeof value.key === "string" &&
    (value.outcome === "pass" || value.outcome === "skip") &&
    typeof value.durationMs === "number"
  );
}
