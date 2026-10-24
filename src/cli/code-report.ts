import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeStore } from "../core/code/store/types.js";
import { isTooBig } from "../core/delivery/code-deliver.js";
import { changedSince, codeSince, type ShellSession } from "../core/delivery/code-since.js";
import { blobHash } from "../core/hash/index.js";
import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeOutcome,
  DecisionKind,
  FunctionCount,
} from "../core/types/code.js";
import type {
  AbsolutePath,
  FileHash,
  RelativePath,
  RevisionNumber,
  Store,
  WorktreeId,
} from "../core/types/index.js";

/*
 * Spec 015 D6: what `squeal code` reads, as its versioned JSON shape. It
 * reads the stores and needs no daemon, like `status` (011 C6).
 */

/** One function `squeal code` lists. */
export interface CodeReportFunction {
  readonly path: RelativePath;
  readonly qualifiedName: string;
  readonly occurrence: number;
  /** Its first line in the current count; `null` when the file's count is not stored. */
  readonly line: number | null;
  readonly outcome: CodeOutcome;
  readonly complexity: number | null;
  readonly threshold: number | null;
  readonly decisions: Readonly<Partial<Record<DecisionKind, number>>>;
  /** The revision its state last changed: when it went over, for a failing one. */
  readonly changedAt: RevisionNumber | null;
}

/**
 * A file whose functions are not judged, and why. `pending`: its bytes are
 * no longer the blob its count holds, so the pass has not counted the edit
 * yet (row 015-22).
 */
export interface CodeReportFile {
  readonly path: RelativePath;
  readonly reason: "too-big" | "parse-error" | "not-counted" | "pending";
  /** Bytes; for `pending`, of the file now. */
  readonly size: number;
  /** For `parse-error`: the functions in an error's range, `unknown`. */
  readonly unknown?: number;
  /** For `pending`: the revision its stored count is of; the file changed after it. */
  readonly revision?: RevisionNumber;
}

/** `squeal code --json`. */
export interface CodeReport {
  readonly v: 1;
  /** `false` in the shape a command that cannot answer prints, with its `message`. */
  readonly available: true;
  readonly threshold: number;
  readonly maxFileBytes: number;
  /** The paths asked for, worktree-relative; `null` without paths: every function over. */
  readonly paths: readonly RelativePath[] | null;
  /** With `--changed`: the registration changes count from; `null` when no consumer is registered. */
  readonly changedSince?: {
    readonly revision: RevisionNumber;
    readonly scope: "session" | "oldest";
  } | null;
  readonly functions: readonly CodeReportFunction[];
  readonly files: readonly CodeReportFile[];
}

export interface CodeReportOptions {
  readonly paths: readonly RelativePath[] | null;
  readonly changed: boolean;
  readonly shell: ShellSession | null;
  /**
   * The worktree's root: with paths, a file whose bytes there are not its
   * counted blob is `pending` (row 015-22). Absent, no file is compared.
   */
  readonly root?: AbsolutePath;
}

const inPaths = (paths: readonly RelativePath[] | null) => (path: RelativePath) =>
  paths === null || paths.some((p) => p === "" || path === p || path.startsWith(`${p}/`));

const key = (c: Pick<CodeCheckId, "path" | "qualifiedName" | "occurrence">) =>
  JSON.stringify([c.path, c.qualifiedName, c.occurrence]);

/** The counted functions of the worktree's file at `path` by identity, each file read once. */
function countsOf(code: CodeStore, worktreeId: WorktreeId) {
  const read = new Map<RelativePath, ReadonlyMap<string, FunctionCount>>();
  return (path: RelativePath): ReadonlyMap<string, FunctionCount> => {
    let functions = read.get(path);
    if (functions === undefined) {
      const [file] = code.files.list(worktreeId, [path]);
      functions = file === undefined ? new Map() : counted(code, file);
      read.set(path, functions);
    }
    return functions;
  };
}

function fromState(
  functionsOf: (path: RelativePath) => ReadonlyMap<string, FunctionCount>,
  s: CodeKnownState,
): CodeReportFunction {
  const fn = functionsOf(s.check.path).get(key(s.check));
  return {
    path: s.check.path,
    qualifiedName: s.check.qualifiedName,
    occurrence: s.check.occurrence,
    line: fn?.range.startLine ?? null,
    outcome: s.outcome,
    complexity: s.value,
    threshold: s.threshold,
    decisions: fn?.decisions ?? {},
    changedAt: s.changedAt,
  };
}

/** The file's counted functions by identity; empty when its count is not stored. */
function counted(code: CodeStore, file: CodeFile): ReadonlyMap<string, FunctionCount> {
  const count = code.counts.get(file.blob, file.language, file.counterVersion);
  return new Map((count?.functions ?? []).map((f) => [key({ ...f, path: file.path }), f]));
}

/** Every function of `file` in its count, joined to its state. */
function fileFunctions(
  code: CodeStore,
  file: CodeFile,
  states: ReadonlyMap<string, CodeKnownState>,
): CodeReportFunction[] {
  return [...counted(code, file).values()].map((f) => {
    const s = states.get(key({ ...f, path: file.path }));
    return {
      path: file.path,
      qualifiedName: f.qualifiedName,
      occurrence: f.occurrence,
      line: f.range.startLine,
      outcome: s?.outcome ?? "pending",
      complexity: f.complexity,
      threshold: s?.threshold ?? null,
      decisions: f.decisions,
      changedAt: s?.changedAt ?? null,
    };
  });
}

/** As `hashFile`'s: a symlink at the last component is never followed, a fifo never blocks. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** A regular file's bytes; `null` for anything else, or when it is gone. */
function regularBytes(path: string): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, OPEN_FLAGS);
  } catch {
    return null;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd) : null;
  } finally {
    closeSync(fd);
  }
}

/** A git blob id names its object format by its length: 40 hex digits for SHA-1, 64 for SHA-256. */
const formatOf = (blob: FileHash) => (blob.length === 64 ? "sha256" : "sha1");

/** A file whose count is behind its bytes: its size now, and the revision its count is of. */
interface Behind {
  readonly size: number;
  readonly revision: RevisionNumber;
}

/**
 * Row 015-22: the files whose bytes under `root` are not the blob their
 * count is stored for, or the blob their states were judged on: an edit the
 * pass has not counted yet, or has counted and not judged (it writes the
 * files row first and the states last), or a blob the counter failed on
 * (D5's `pending`). A file gone, or no regular file, is not compared; the
 * pass removes it.
 */
function behindOnDisk(
  root: AbsolutePath,
  files: readonly CodeFile[],
  states: readonly CodeKnownState[],
): Map<RelativePath, Behind> {
  const judged = new Map<RelativePath, CodeKnownState[]>();
  for (const s of states) {
    const own = judged.get(s.check.path);
    if (own === undefined) judged.set(s.check.path, [s]);
    else own.push(s);
  }
  const behind = new Map<RelativePath, Behind>();
  for (const f of files) {
    const bytes = regularBytes(join(root, f.path));
    if (bytes === null) continue;
    const blob = blobHash(bytes, formatOf(f.blob));
    const own = judged.get(f.path) ?? [];
    if (blob === f.blob && own.every((s) => s.blob === blob)) continue;
    const revision = Math.min(f.revision, ...own.map((s) => s.countedAt));
    behind.set(f.path, { size: bytes.byteLength, revision });
  }
  return behind;
}

/**
 * The files not judged, in path order: pending, too big, not counted yet,
 * parse errors. A file has parse errors when its stored count does (D3),
 * whether or not a function is in one; the `unknown` functions are the
 * detail (review 0.1.283 B4).
 */
function notJudged(
  code: CodeStore,
  files: readonly CodeFile[],
  states: readonly CodeKnownState[],
  behind: ReadonlyMap<RelativePath, Behind>,
): CodeReportFile[] {
  const unknown = new Map<RelativePath, number>();
  for (const s of states) {
    if (s.outcome === "unknown") unknown.set(s.check.path, (unknown.get(s.check.path) ?? 0) + 1);
  }
  return files.flatMap((f): CodeReportFile[] => {
    const late = behind.get(f.path);
    if (late !== undefined) return [{ path: f.path, reason: "pending", ...late }];
    if (isTooBig(f)) return [{ path: f.path, reason: "too-big", size: f.size }];
    const count = code.counts.get(f.blob, f.language, f.counterVersion);
    if (count === null) return [{ path: f.path, reason: "not-counted", size: f.size }];
    if (count.errors.length === 0) return [];
    return [
      { path: f.path, reason: "parse-error", size: f.size, unknown: unknown.get(f.path) ?? 0 },
    ];
  });
}

/**
 * Spec 015 D6: without paths, every function over the threshold, newest
 * first by the revision it went over; with paths, every function in those
 * files or below those directories, but a file `pending` since an edit
 * lists none (`root`). `changed` keeps those whose state changed since the
 * registration `codeSince` names.
 */
export function readCodeReport(
  main: Store,
  code: CodeStore,
  worktreeId: WorktreeId,
  policy: { readonly threshold: number; readonly maxFileBytes: number },
  options: CodeReportOptions,
): CodeReport {
  const keep = inPaths(options.paths);
  const files = code.files.list(worktreeId).filter((f) => keep(f.path));
  const functionsOf = countsOf(code, worktreeId);
  const states = code.states.list(worktreeId, { measure: "complexity" });
  const behind =
    options.paths === null || options.root === undefined
      ? new Map<RelativePath, Behind>()
      : behindOnDisk(options.root, files, states);
  const since = options.changed ? codeSince(main, worktreeId, options.shell) : undefined;
  const changed =
    since === undefined
      ? null
      : new Set(
          since === null
            ? []
            : changedSince(code, worktreeId, since.since).map((s) => key(s.check)),
        );
  const listed =
    options.paths === null
      ? states
          .filter((s) => s.outcome === "fail" || (changed !== null && s.outcome === "pass"))
          .map((s) => fromState(functionsOf, s))
      : files
          .filter((f) => !behind.has(f.path))
          .flatMap((f) => fileFunctions(code, f, new Map(states.map((s) => [key(s.check), s]))));
  const functions = listed
    .filter((f) => changed === null || changed.has(key(f)))
    .sort(
      (a, b) =>
        (options.paths === null ? (b.changedAt ?? 0) - (a.changedAt ?? 0) : 0) ||
        a.path.localeCompare(b.path) ||
        (a.line ?? 0) - (b.line ?? 0),
    );
  return {
    v: 1,
    available: true,
    threshold: policy.threshold,
    maxFileBytes: policy.maxFileBytes,
    paths: options.paths,
    ...(since === undefined
      ? {}
      : { changedSince: since === null ? null : { revision: since.since, scope: since.scope } }),
    functions,
    files: notJudged(code, files, states, behind),
  };
}
