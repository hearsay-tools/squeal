import type { CodeStore } from "../core/code/store/types.js";
import { isTooBig } from "../core/delivery/code-deliver.js";
import { changedSince, codeSince, type ShellSession } from "../core/delivery/code-since.js";
import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeOutcome,
  DecisionKind,
  FunctionCount,
} from "../core/types/code.js";
import type { RelativePath, RevisionNumber, Store, WorktreeId } from "../core/types/index.js";

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

/** A file whose functions are not judged, and why. */
export interface CodeReportFile {
  readonly path: RelativePath;
  readonly reason: "too-big" | "parse-error" | "not-counted";
  readonly size: number;
  /** For `parse-error`: the functions in an error's range, `unknown`. */
  readonly unknown?: number;
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

/**
 * The files not judged, in path order: too big, not counted yet, parse
 * errors. A file has parse errors when its stored count does (D3), whether
 * or not a function is in one; the `unknown` functions are the detail
 * (review 0.1.283 B4).
 */
function notJudged(
  code: CodeStore,
  worktreeId: WorktreeId,
  states: readonly CodeKnownState[],
  keep: (path: RelativePath) => boolean,
): CodeReportFile[] {
  const files = code.files.list(worktreeId).filter((f) => keep(f.path));
  const unknown = new Map<RelativePath, number>();
  for (const s of states) {
    if (s.outcome === "unknown") unknown.set(s.check.path, (unknown.get(s.check.path) ?? 0) + 1);
  }
  return files.flatMap((f): CodeReportFile[] => {
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
 * files or below those directories. `changed` keeps those whose state
 * changed since the registration `codeSince` names.
 */
export function readCodeReport(
  main: Store,
  code: CodeStore,
  worktreeId: WorktreeId,
  policy: { readonly threshold: number; readonly maxFileBytes: number },
  options: CodeReportOptions,
): CodeReport {
  const keep = inPaths(options.paths);
  const functionsOf = countsOf(code, worktreeId);
  const states = code.states.list(worktreeId, { measure: "complexity" });
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
      : code.files
          .list(worktreeId)
          .filter((f) => keep(f.path))
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
    files: notJudged(code, worktreeId, states, keep),
  };
}
