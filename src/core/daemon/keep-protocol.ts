import type { RunOutcome } from "../types/check.js";
import type { SourceLocation, WorktreeId } from "../types/common.js";
import type { KeepRequest, KeepWrite, SeenReads } from "../types/daemon-writes.js";
import type { CheckKey } from "../types/keys.js";
import type { Provenance, ResultRecord } from "../types/store-records.js";

/*
 * Row 021-20, review 0.1.450 B3: a `keep` request is checked whole before
 * the daemon opens a store for it. It admits only what the code gate's
 * keeper writes (spec 020 D17.3): one test file's coverage record at its
 * key, or that file's results at that key, as `recordsForFile` builds them
 * (test and file checks, `pass`, `fail` or `skip`, the gate's run, this
 * worktree's provenance). Row 020-48: or the reads of the gate's runs, per
 * test file, for the shared observed rows. Anything else is refused, so
 * nothing is written.
 */

/** Records one results write may carry; a test file has far fewer checks. */
const MAX_RECORDS = 100_000;
const OUTCOMES: ReadonlySet<RunOutcome> = new Set(["pass", "fail", "skip"]);
const PHASES: ReadonlySet<string> = new Set(["load", "after-tests", "setup"]);
const RECORD_FIELDS = [
  "check",
  "key",
  "outcome",
  "durationMs",
  "location",
  "fingerprint",
  "summary",
  "errors",
  "provenance",
] as const;

type Fields = Record<string, unknown>;

/** A `keep` request, every field checked; a string says what is wrong. */
export function parseKeep(request: Fields): KeepRequest | string {
  const { id, worktreeId, storeSchema } = request;
  if (!isText(id) || id.length > 128)
    return '"id" must be a non-empty string of 128 characters at most';
  if (!isText(worktreeId)) return '"worktreeId" must be a non-empty string';
  if (!Number.isInteger(storeSchema)) return '"storeSchema" must be an integer';
  const write = parseKeepWrite(request.write, worktreeId as WorktreeId);
  if (typeof write === "string") return write;
  return {
    type: "keep",
    id,
    worktreeId: worktreeId as WorktreeId,
    storeSchema: storeSchema as number,
    write,
  };
}

function parseKeepWrite(value: unknown, worktreeId: WorktreeId): KeepWrite | string {
  if (!isFields(value)) return '"write" must be an object';
  switch (value.kind) {
    case "coverage": {
      const extra = unknownField(value, ["kind", "key", "record"]);
      if (extra !== null) return `"write.${extra}" is not a field of a coverage write`;
      if (!isKey(value.key)) return '"write.key" must be a result key';
      const record = coverageRecord(value.record);
      if (record !== null) return `"write.record" ${record}`;
      return { kind: "coverage", key: value.key, record: value.record };
    }
    case "results":
      return parseResults(value, worktreeId);
    case "seen":
      return parseSeen(value);
    default:
      return '"write.kind" must be "coverage", "results" or "seen"';
  }
}

/** Row 020-48: the reads of the gate's runs, one entry per test file (`SeenReads`). */
function parseSeen(value: Fields): KeepWrite | string {
  const extra = unknownField(value, ["kind", "seen"]);
  if (extra !== null) return `"write.${extra}" is not a field of a seen write`;
  const { seen } = value;
  if (!Array.isArray(seen) || seen.length === 0 || seen.length > MAX_RECORDS) {
    return `"write.seen" must be a list of 1 to ${MAX_RECORDS} test files' reads`;
  }
  for (const [at, one] of seen.entries()) {
    const why = seenReads(one);
    if (why !== null) return `"write.seen[${at}]" ${why}`;
  }
  return { kind: "seen", seen: seen as SeenReads[] };
}

/** Why `value` is not one test file's reads; `null` when it is. */
function seenReads(value: unknown): string | null {
  if (!isFields(value)) return "must be an object";
  const extra = unknownField(value, ["ref", "add", "direct", "modules"]);
  if (extra !== null) return `has the unknown field "${extra}"`;
  const { ref } = value;
  if (
    !isFields(ref) ||
    typeof ref.project !== "string" ||
    !isPath(ref.path) ||
    unknownField(ref, ["project", "path"]) !== null
  ) {
    return '"ref" must name a project and a test file';
  }
  for (const field of ["add", "direct", "modules"] as const) {
    if (!isPathList(value[field])) return `"${field}" must be a list of relative paths`;
  }
  return null;
}

function parseResults(value: Fields, worktreeId: WorktreeId): KeepWrite | string {
  const extra = unknownField(value, ["kind", "key", "records", "paths", "environmentFiles"]);
  if (extra !== null) return `"write.${extra}" is not a field of a results write`;
  const { key, records, paths, environmentFiles } = value;
  if (!isKey(key)) return '"write.key" must be a result key';
  if (!isPathList(paths)) return '"write.paths" must be a list of relative paths';
  if (!isPathList(environmentFiles))
    return '"write.environmentFiles" must be a list of relative paths';
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_RECORDS) {
    return `"write.records" must be a list of 1 to ${MAX_RECORDS} results`;
  }
  const seen = new Set<string>();
  for (const [at, record] of records.entries()) {
    const why = resultRecord(record, key, worktreeId);
    if (why !== null) return `"write.records[${at}]" ${why}`;
    // One file at one key, each check once, all from one run (`recordsForFile`).
    const other = otherFileOrRun(record as ResultRecord, records[0] as ResultRecord);
    if (other !== null) return `"write.records[${at}]" is ${other}`;
    const id = JSON.stringify(record.check);
    if (seen.has(id)) return `"write.records[${at}]" repeats a check`;
    seen.add(id);
  }
  return {
    kind: "results",
    key,
    records: records as ResultRecord[],
    paths,
    environmentFiles,
  };
}

/** Whether `record` is of another test file or run than `first`, the write's first record. */
function otherFileOrRun(record: ResultRecord, first: ResultRecord): string | null {
  const { check, provenance } = record;
  if (check.project !== first.check.project || check.testPath !== first.check.testPath) {
    return "another test file's";
  }
  const fields = ["worktreeId", "revision", "commit", "dirty", "runId", "recordedAt"] as const;
  return fields.every((f) => provenance[f] === first.provenance[f]) ? null : "another run's";
}

/** Why `value` is not a result `recordsForFile` builds at `key` for this worktree; `null` when it is. */
function resultRecord(value: unknown, key: CheckKey, worktreeId: WorktreeId): string | null {
  if (!isFields(value)) return "must be an object";
  const extra = unknownField(value, RECORD_FIELDS);
  if (extra !== null) return `has the unknown field "${extra}"`;
  const check = checkId(value.check);
  if (check !== null) return `"check" ${check}`;
  if (value.key !== key) return "is at another key";
  if (!OUTCOMES.has(value.outcome as RunOutcome)) return '"outcome" must be pass, fail or skip';
  if (!isCount(value.durationMs, true)) return '"durationMs" must be a duration';
  if (value.location !== null && !isLocation(value.location))
    return '"location" must be a location or null';
  if (!isTextOrNull(value.fingerprint)) return '"fingerprint" must be a string or null';
  if (!isTextOrNull(value.summary)) return '"summary" must be a string or null';
  if (!Array.isArray(value.errors)) return '"errors" must be a list';
  for (const [at, error] of value.errors.entries()) {
    const why = checkError(error);
    if (why !== null) return `"errors[${at}]" ${why}`;
  }
  return gateProvenance(value.provenance, worktreeId);
}

/** A test or file check: the gate stores no setup check (`recordsForFile`). */
function checkId(value: unknown): string | null {
  if (!isFields(value)) return "must be an object";
  const { kind, project, testPath, fullName } = value;
  if (typeof project !== "string" || !isPath(testPath))
    return "must name a project and a test file";
  if (kind === "file")
    return unknownField(value, ["kind", "project", "testPath"]) === null
      ? null
      : "has an unknown field";
  if (kind !== "test") return 'must be of kind "test" or "file"';
  if (typeof fullName !== "string") return '"fullName" must be a string';
  return unknownField(value, ["kind", "project", "testPath", "fullName"]) === null
    ? null
    : "has an unknown field";
}

function checkError(value: unknown): string | null {
  if (!isFields(value)) return "must be an object";
  const fields = [
    "name",
    "message",
    "stack",
    "location",
    "diff",
    "loadAverage",
    "code",
    "causes",
    "phase",
    "recorder",
  ];
  const extra = unknownField(value, fields);
  if (extra !== null) return `has the unknown field "${extra}"`;
  const { name, message, stack, location, diff, loadAverage, code, causes, phase, recorder } =
    value;
  if (typeof name !== "string" || typeof message !== "string")
    return "must have a name and a message";
  if (!isTextOrNull(stack) || !isTextOrNull(diff))
    return '"stack" and "diff" must be strings or null';
  if (location !== null && !isLocation(location)) return '"location" must be a location or null';
  if (loadAverage !== undefined && !isCount(loadAverage, true))
    return '"loadAverage" must be a number';
  if (code !== undefined && typeof code !== "string") return '"code" must be a string';
  if (recorder !== undefined && typeof recorder !== "string") return '"recorder" must be a string';
  if (phase !== undefined && !PHASES.has(phase as string))
    return '"phase" must be load, after-tests or setup';
  if (causes === undefined) return null;
  const valid = (c: unknown) =>
    isFields(c) &&
    typeof c.message === "string" &&
    (c.code === undefined || typeof c.code === "string") &&
    unknownField(c, ["message", "code"]) === null;
  return Array.isArray(causes) && causes.every(valid) ? null : '"causes" must be a list of causes';
}

/** The gate's provenance (`Keeper.#write`): this worktree, its run id `gate-…`. */
function gateProvenance(value: unknown, worktreeId: WorktreeId): string | null {
  if (!isFields(value)) return '"provenance" must be an object';
  const fields = ["worktreeId", "revision", "commit", "dirty", "runId", "recordedAt"];
  if (unknownField(value, fields) !== null) return '"provenance" has an unknown field';
  const { revision, commit, dirty, runId, recordedAt } = value as Partial<Provenance> & Fields;
  if (value.worktreeId !== worktreeId) return '"provenance.worktreeId" must be this worktree';
  if (!isCount(revision, false)) return '"provenance.revision" must be a revision';
  if (commit !== null && !(typeof commit === "string" && /^[0-9a-f]{40,64}$/.test(commit))) {
    return '"provenance.commit" must be a commit or null';
  }
  if (typeof dirty !== "boolean") return '"provenance.dirty" must be true or false';
  if (typeof runId !== "string" || !/^gate-[0-9a-f-]{36}$/.test(runId))
    return '"provenance.runId" must be a gate run';
  if (!isCount(recordedAt, false)) return '"provenance.recordedAt" must be a time';
  return null;
}

/** Why `value` is not a coverage record (spec 015 D8, `CoverageRecord`); `null` when it is. */
function coverageRecord(value: unknown): string | null {
  if (!isFields(value) || value.v !== 1) return "must be a version 1 coverage record";
  if (unknownField(value, ["v", "sources", "unread"]) !== null) return "has an unknown field";
  if (!isPathList(value.unread)) return '"unread" must be a list of relative paths';
  if (!Array.isArray(value.sources)) return '"sources" must be a list';
  for (const [at, source] of value.sources.entries()) {
    if (!isFields(source)) return `"sources[${at}]" must be an object`;
    if (unknownField(source, ["path", "blob", "lines", "covered", "functions"]) !== null) {
      return `"sources[${at}]" has an unknown field`;
    }
    const { path, blob, lines, covered, functions } = source;
    if (!isPath(path)) return `"sources[${at}].path" must be a relative path`;
    if (typeof blob !== "string" || !/^[0-9a-f]{40,64}$/.test(blob)) {
      return `"sources[${at}].blob" must be a blob id`;
    }
    if (!isBase64(lines) || !isBase64(covered)) return `"sources[${at}]" lines must be bitsets`;
    if (!Array.isArray(functions) || !functions.every(isFunctionSpan)) {
      return `"sources[${at}].functions" must be a list of spans`;
    }
  }
  return null;
}

/** `[start line, start column, end line, end column, hit]`, as `CoverageSource.functions`. */
function isFunctionSpan(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    value.slice(0, 4).every((n) => isCount(n, false)) &&
    (value[4] === 0 || value[4] === 1)
  );
}

function isLocation(value: unknown): value is SourceLocation {
  return (
    isFields(value) &&
    isPath(value.path) &&
    isCount(value.line, false) &&
    isCount(value.column, false) &&
    unknownField(value, ["path", "line", "column"]) === null
  );
}

/** The first field of `value` not among `known`; `null` when there is none. */
function unknownField(value: Fields, known: readonly string[]): string | null {
  return Object.keys(value).find((field) => !known.includes(field)) ?? null;
}

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTextOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}

/** A whole number, at least 0 (a duration or load may have a fraction with `fraction`). */
function isCount(value: unknown, fraction: boolean): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  return fraction || Number.isInteger(value);
}

function isKey(value: unknown): value is CheckKey {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** A path relative to the worktree root: not empty, not absolute, no NUL. */
function isPath(value: unknown): value is string {
  return isText(value) && !value.startsWith("/") && !value.includes("\0");
}

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isPath);
}

function isBase64(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}
