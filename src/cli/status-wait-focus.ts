import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/index.js";
import { readFocused } from "../core/scheduler/focused-row.js";
import { slowView } from "../core/scheduler/slow.js";
import { formatCheck } from "../core/state/index.js";
import type {
  AbsolutePath,
  CheckKey,
  ResultRecord,
  RevisionNumber,
  StatusFocused,
  StatusFocusedCheck,
  Store,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";
import { answerOf, type FocusTally, holdsText, storedTally } from "./status-wait-focus-answer.js";
import type { FocusReply } from "./status-wait-promote.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23, "Focused checks";
 * `tasks/011-135/design.md` section 1): `status --wait <ms> <test file>...
 * --check <text>...` asks the daemon to run the selected checks of each
 * file named by its own path first, alone, and returns at their outcome.
 * A focused run is never a result: it decides no verdict, and only the
 * wait that asked for it reads it.
 */

/** `--check` given with no test file named by its own path (C15). */
export const CHECK_NEEDS_TEST_FILE =
  "--check selects checks inside a test file named by its own path";

/**
 * Takes each `--check <text>` or `--check=<text>` out of `args`; a string
 * is the usage error for a missing or empty text.
 */
export function takeChecks(
  args: readonly string[],
): { readonly checks: readonly string[]; readonly rest: readonly string[] } | string {
  const checks: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg !== "--check" && !arg.startsWith("--check=")) {
      rest.push(arg);
      continue;
    }
    const text = arg === "--check" ? args[++i] : arg.slice("--check=".length);
    if (text === undefined || text === "") return "--check takes a part of a check name";
    checks.push(text);
  }
  return { checks, rest };
}

/**
 * The texts as the wait sends them: a text that begins with the printed
 * prefix of one of `files` (`[project] <path> > `, as `formatCheck` prints a
 * check) is read without it, so a name copied from a failure line selects
 * what its full name selects (C15). The request carries one list for every
 * file, so a prefix is stripped whichever named file it names.
 */
export function focusTexts(texts: readonly string[], files: readonly TestFileRef[]): string[] {
  const prefixes = files.map((ref) =>
    formatCheck({ kind: "test", project: ref.project, testPath: ref.path, fullName: "" }),
  );
  const read = texts.map((text) => {
    const prefix = prefixes.find((p) => text.startsWith(p) && text.length > p.length);
    return prefix === undefined ? text : text.slice(prefix.length);
  });
  return [...new Set(read)];
}

/**
 * Why the daemon gives `ref` no focused run, read from the policy as the
 * daemon decides it (row 011-145): a slow file, or a runner that runs whole
 * files only (node:test); `null` for a file it focuses.
 */
export function wholeFileReasons(
  root: AbsolutePath,
  files: readonly TestFileRef[],
): ReadonlyMap<string, string> {
  const reasons = new Map<string, string>();
  if (files.length === 0) return reasons;
  const policy = readPolicy(root);
  const slow = slowView(policy);
  for (const ref of files) {
    if (slow.isSlow(ref))
      reasons.set(testFileId(ref), "slow file: focused checks run for fast files only");
    else if (policy.nodeTest.some((p) => p.name === ref.project)) {
      reasons.set(testFileId(ref), "node:test runs whole files only");
    }
  }
  return reasons;
}

/** One selected check of a stored result, in a focused run's shape. */
export type StoredCheck = StatusFocusedCheck;

/**
 * What the wait knows of one file named by its own path: why it gets no
 * focused run; the focused run at its current key for the wait's texts,
 * with only the checks that hold one of them (`answerOf`); or
 * the selected checks of the result stored at that key, which the file's
 * own run wrote first (C15).
 */
export interface FocusedFile {
  readonly testFile: TestFileRef;
  /** The file's current key; `null` while it has none. */
  readonly key: CheckKey | null;
  /**
   * Why it gets no focused answer, so the wait waits for its own run: the
   * daemon gives it no focused run (`wholeFileReasons`), or its run's list
   * proves no pass (`answerOf`'s fallback, review 0.1.286 B2).
   */
  readonly whole?: string;
  /** Its newest focused run at its current key whose texts hold the wait's, ended or not, as `answerOf` gives it. */
  readonly run?: StatusFocused;
  /** The count it answers with: of the stored result, else of its ended run (B2). */
  readonly tally?: FocusTally;
  /** With a result stored at its key: the selected checks of it, and how many checks it has. */
  readonly stored?: {
    readonly revision: RevisionNumber;
    readonly runId: string;
    readonly checks: readonly StoredCheck[];
    readonly collected: number;
  };
}

/** Whether the wait has the file's focused answer: an ended run's count or a stored result at its key. */
export function answered(file: FocusedFile): boolean {
  return file.whole === undefined && file.tally !== undefined;
}

/**
 * Each of `files` as the wait reads it, from one read of the store: the
 * focused meta row, the files' keys and the results stored at those keys.
 */
export function readFocusedFiles(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[],
  texts: readonly string[],
  whole: ReadonlyMap<string, string>,
): FocusedFile[] {
  const keys = new Map(
    store.testFileKeys.list(worktreeId, files).map((row) => [testFileId(row.testFile), row.key]),
  );
  const runs = new Map(
    readFocused(store, worktreeId).map((run) => [testFileId(run.testFile), run]),
  );
  return files.map((testFile) => {
    const id = testFileId(testFile);
    const key = keys.get(id) ?? null;
    const reason = whole.get(id);
    if (reason !== undefined) return { testFile, key, whole: reason };
    const own = runs.get(id);
    const answer =
      own !== undefined && key !== null && own.key === key ? answerOf(own, texts) : undefined;
    // `usedAt` 0: a read, not a lookup hit.
    const results = key === null ? [] : store.results.byKey(key, 0);
    const stored = results.length === 0 ? undefined : storedOf(results, texts);
    // A result its own run stored at the key supersedes the focused run (C5).
    const tally = stored === undefined ? answer?.tally : storedTally(stored.checks);
    const fallback = stored === undefined ? answer?.fallback : undefined;
    return {
      testFile,
      key,
      ...(fallback === undefined ? {} : { whole: fallback }),
      ...(answer === undefined ? {} : { run: answer.run }),
      ...(stored === undefined ? {} : { stored }),
      ...(tally === undefined ? {} : { tally }),
    };
  });
}

function storedOf(
  results: readonly ResultRecord[],
  texts: readonly string[],
): FocusedFile["stored"] {
  const selected = results.filter((r) =>
    r.check.kind === "test" ? holdsText(r.check.fullName, texts) : r.outcome === "fail",
  );
  const [first] = results;
  return {
    revision: (first?.provenance.revision ?? 0) as RevisionNumber,
    runId: first?.provenance.runId ?? "",
    checks: selected.map((r) => ({
      check: r.check,
      name: formatCheck(r.check),
      outcome: r.outcome,
      durationMs: r.durationMs,
      summary: r.summary,
      location: r.location,
    })),
    collected: results.filter((r) => r.check.kind === "test").length,
  };
}

/** Whether a selected check failed, in a focused run or a stored result, by its count (B2). */
export function anyFailed(files: readonly FocusedFile[]): boolean {
  return files.some((f) => answered(f) && (f.tally?.failed ?? 0) > 0);
}

/**
 * What a named wait with `--check` read (row 011-146): the texts it sent,
 * each file named by its own path, and, when the daemon did not know the
 * request, its version: the wait then reads as a named wait (C15).
 */
export interface NamedFocus {
  readonly texts: readonly string[];
  readonly files: readonly FocusedFile[];
  readonly refused?: { readonly version: string | null };
  /** A snapshot's `--check` with no test file named by its own path: the usage error it exits 2 with. */
  readonly usage?: string;
}

/**
 * Row 011-146 (C15 as amended 2026-10-23): a wait's outcome from the named
 * wait's (`decidedOutcome`), the focus it read and the daemon's answer to
 * `focus`; `null` while it waits. Without `--check`, or when the daemon
 * refused the request, the named outcome. With a selected file pending,
 * `focused` once each file the daemon focuses has its answer, and there is
 * one. With none pending (review 0.1.286 B6): `settled`, the named verdict,
 * when each such file has a result at its key (current before any focused
 * run) or the daemon gave no answer; `focused` once each has its answer;
 * else `null`, so the wait sends its request: an unknown or stale file that
 * nothing queues is not current.
 */
export function focusOutcome(
  named: "settled" | "unmatched" | "slow" | null,
  focus: NamedFocus | undefined,
  reply: FocusReply | undefined,
): "settled" | "focused" | "unmatched" | "slow" | null {
  if (focus === undefined || focus.refused !== undefined) return named;
  const focusing = focus.files.filter((f) => f.whole === undefined);
  if (named === null) return focusing.length > 0 && focusing.every(answered) ? "focused" : null;
  if (named !== "settled") return named;
  const keyed = focusing.filter((f) => f.key !== null);
  if (keyed.every((f) => f.stored !== undefined)) return "settled";
  if (keyed.every(answered)) return "focused";
  return reply === "none" ? "settled" : null;
}

/** Row 011-146 (C15): `--check` with no test file named by its own path; the command exits 2. */
export class CheckUsageError extends Error {}

/**
 * Row 011-146: what a wait with `checks` reads of the files named by their
 * own paths (`own`), from its read of the store; `undefined` without
 * `checks` or such a file. `whole` names the files the daemon runs whole;
 * `reply` is the daemon's answer to `focus`, once it came.
 */
export function focusOf(
  store: Store,
  worktreeId: WorktreeId,
  own: readonly TestFileRef[],
  checks: readonly string[],
  whole: ReadonlyMap<string, string>,
  reply: FocusReply | undefined,
  record: { readonly squealVersion: string } | null,
): NamedFocus | undefined {
  if (checks.length === 0 || own.length === 0) return undefined;
  const texts = focusTexts(checks, own);
  const files = readFocusedFiles(store, worktreeId, own, texts, whole);
  const refused =
    reply === "refused" ? { refused: { version: record?.squealVersion ?? null } } : {};
  return { texts, files, ...refused };
}

/**
 * Row 011-146 (C6 as amended 2026-10-23): what `status <path>... --check
 * <text>...` without `--wait` reads of the selected checks, the focused
 * runs and the results stored at the files' keys; it sends nothing. With
 * checks, once the daemon listed the revision (`ready`), and no file named by
 * its own path (`own`), the usage error, whatever the paths select (review
 * 0.1.286 B4), which `printNamed` gives: it reads inside the store's read,
 * which turns a throw into an unreadable store.
 */
export function snapshotFocus(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  ready: boolean,
  own: readonly TestFileRef[],
  checks: readonly string[],
): NamedFocus | undefined {
  if (checks.length === 0) return undefined;
  if (ready && own.length === 0) {
    return { texts: checks, files: [], usage: CHECK_NEEDS_TEST_FILE };
  }
  return focusOf(store, worktreeId, own, checks, wholeFileReasons(root, own), undefined, null);
}
