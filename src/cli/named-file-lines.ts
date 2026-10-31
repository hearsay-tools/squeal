import { testFileId } from "../core/keys/index.js";
import { testFileKeyOf } from "../core/state/index.js";
import { formatCheck } from "../core/status/index.js";
import { type NextStep, nextStep, type Standing } from "../core/status/next-step.js";
import {
  fill,
  fromBase,
  reasonWords,
  stepCommand,
  stepText,
} from "../core/status/next-step-text.js";
import { groupId, widest } from "../core/status/standing-groups.js";
import { atText } from "../core/status/test-frame.js";
import { plural, testFileText } from "../core/text.js";
import type {
  BatchPlace,
  FileEnd,
  LastYield,
  StatusSnapshot,
  TestFileRef,
} from "../core/types/index.js";
import { fileEndId, withFileEnd } from "./named-file-end.js";
import type { NamedFile, NamedVerdict } from "./named-files.js";
import type { NamedSelection } from "./named-selection.js";
import type { FileClass } from "./verdict.js";

/*
 * Task 011-12 (011 C15, issues 17 and 23): the text a named wait gives each
 * selected file. A block per class groups them, each pending, stale or
 * unknown group with what holds it and, row 011-27 (C15 as amended
 * 2026-10-20), what advances it (`nextStep`); each current one with its
 * verdict. The verdict line counts the groups, each with its command. Row
 * 011-274 (gh-111): a running file that ended reads in a line of its own.
 */

/** How many files a group's line names before "and N more". */
export const CLASS_FILES_SHOWN = 10;

const CLASSES: readonly [FileClass, string][] = [
  ["pending", "Pending"],
  ["current", "Current"],
  ["stale", "Stale"],
  ["unknown", "Unknown"],
];

/**
 * `Pending (3):`, then a line per group: `  2 queued behind the vitest tier
 * of 4 test files running since 12:00:03: a, b; no command runs them sooner
 * (…)`. One block per class there is.
 */
export function classLines(files: readonly NamedFile[], command: string, base?: string): string[] {
  return CLASSES.flatMap(([state, label]) => {
    const of = files.filter((f) => f.state === state);
    if (of.length === 0) return [];
    return [
      `${label} (${of.length}):`,
      ...groupsOf(of).map((g) => `  ${groupLine(g, command, base)}`),
    ];
  });
}

/** Files that read alike: one standing, or one verdict for a current file. */
interface Group {
  readonly files: readonly TestFileRef[];
  /** `null` for current files and an unlisted one, which `words` names. */
  readonly next: NextStep | null;
  readonly words: string;
}

function groupsOf(files: readonly NamedFile[]): Group[] {
  const groups = new Map<
    string,
    { files: TestFileRef[]; standing?: Standing; end?: FileEnd; words: string }
  >();
  for (const f of files) {
    const standing = standingOf(f);
    const id =
      standing === undefined
        ? `verdict ${f.verdict}`
        : groupId(standing) + retriedId(standing) + fileEndId(f.end);
    const group = groups.get(id);
    if (group === undefined) {
      const words = f.verdict ?? "not listed in this worktree";
      groups.set(id, {
        files: [f.testFile],
        ...(standing === undefined ? {} : { standing }),
        ...(f.end === undefined ? {} : { end: f.end }),
        words,
      });
      continue;
    }
    group.files.push(f.testFile);
    if (standing !== undefined && group.standing !== undefined) {
      group.standing = widest(group.standing, standing);
    }
  }
  return [...groups.values()].map(({ files: refs, standing, end, words }) => ({
    files: refs,
    next: standing === undefined ? null : withFileEnd(namedStep(standing), end),
    words,
  }));
}

/** A retry's run and any other queued file never share a line (row 011-283). */
function retriedId(standing: Standing): string {
  return standing.kind === "queued" && standing.retried === true ? " retried" : "";
}

/**
 * `nextStep`, with why a retry's run or a named slow file waits (row
 * 011-283, `research/named-wait-rule.md` rule 5): named-wait order leaves
 * both where they were, so the line says what they wait for. The text
 * lines and `--json`'s `reason` both read it.
 */
function namedStep(standing: Standing): NextStep {
  const next = nextStep(standing);
  if (standing.kind === "queued" && standing.retried === true) {
    return {
      ...next,
      reason: `${next.reason}; ${RETRY_WAITS}`,
      short: `${next.short}; retry: normal priority`,
    };
  }
  if (standing.kind === "slow" && standing.pausesOnly !== true && standing.slot === undefined) {
    return {
      ...next,
      reason: next.reason.replace(/^slow, /, `${SLOW_WAITS}, `),
      short: SLOW_WAITS,
    };
  }
  return next;
}

/** A retry's run is forced at the file's normal priority (011 C5). */
const RETRY_WAITS = "retry: normal priority; waits for named groups and edits' work";

/** A named slow file runs after the fast tests (004 D2). */
const SLOW_WAITS = "slow, behind the fast backlog";

/** A file's standing; a pending one built before row 011-27 has only its reason. */
function standingOf(f: NamedFile): Standing | undefined {
  return f.state === "current" ? undefined : (f.standing ?? f.pending);
}

function groupLine({ files, next, words }: Group, command: string, base?: string): string {
  const paths = files.map((f) => fromBase(base, f.path));
  const shown = files.slice(0, CLASS_FILES_SHOWN).map(testFileText).join(", ");
  const more =
    files.length > CLASS_FILES_SHOWN ? ` and ${files.length - CLASS_FILES_SHOWN} more` : "";
  if (next === null) return `${files.length} ${words}: ${shown}${more}`;
  const step = stepText(next.step, paths, command);
  return `${files.length} ${reasonWords(next, paths, command)}: ${shown}${more}${step === "" ? "" : `; ${step}`}`;
}

/** How many reason groups the verdict line names before the rest's count (task 011-13). */
export const REASON_GROUPS_SHOWN = 5;

/**
 * The files without a verdict counted by reason, for the verdict line, as
 * `noVerdictText` counts them: the pending ones while any is, else every one
 * without a current result. `1 running since 12:00:03 in the vitest lane, 1
 * stale, nothing queued it: \`squeal retry src/a.test.ts\``: a group whose
 * next step is a command ends with it, so a `tail -1` keeps it (row 011-27).
 * A group gives one clock time, its earliest start or its latest bound, and
 * the line names `REASON_GROUPS_SHOWN` groups, then counts the files of the
 * rest, so it stays bounded however many files are selected and however many
 * worktrees hold them (review wave-1.11 S1). The class lines and
 * `wait.testFiles` still give every file's own reason.
 */
export function reasonGroups(files: readonly NamedFile[], command: string, base?: string): string {
  const pending = files.filter((f) => f.state === "pending");
  const counted = pending.length > 0 ? pending : files.filter((f) => f.state !== "current");
  const all = groupsOf(counted);
  const shown = all.slice(0, REASON_GROUPS_SHOWN).map((g) => groupShort(g, command, base));
  const rest = all.slice(REASON_GROUPS_SHOWN);
  if (rest.length === 0) return shown.join(", ");
  const more = rest.reduce((sum, { files: of }) => sum + of.length, 0);
  const others = rest.length === 1 ? "1 other reason" : `${rest.length} other reasons`;
  return [...shown, `and ${more} more for ${others}`].join(", ");
}

function groupShort({ files, next, words }: Group, command: string, base?: string): string {
  if (next === null) return `${files.length} ${words}`;
  const paths = files.map((f) => fromBase(base, f.path));
  const it = files.length === 1 ? "it" : "them";
  const cmd = stepCommand(next.step, paths, command);
  const short = fill(next.short, cmd, command, it);
  const named = cmd === null || next.short.includes("{command}");
  return `${files.length} ${short}${named ? "" : `: \`${cmd}\``}`;
}

/**
 * Row 011-243 (gh-99): what the current files of a read with no verdict
 * passed or failed, and at which revision: `9 test files passed at revision
 * 6`, `8 test files passed and 1 failed at revision 6`; `null` with none
 * current. `revision` is `null` when it is the read's own, which the clause
 * after it names.
 */
export function coverText(files: readonly NamedFile[], revision: number | null): string | null {
  const current = files.filter((f) => f.state === "current");
  const counted = filesCounted(
    (["pass", "fail", "skip"] as const).map((verdict) => [
      current.filter((f) => f.verdict === verdict).length,
      verdict === "pass" ? "passed" : verdict === "fail" ? "failed" : "skipped",
    ]),
  );
  if (counted === null) return null;
  return revision === null ? counted : `${counted} at revision ${revision}`;
}

/** `2 test files running and 677 queued`: the non-zero counts, the first naming its files; `null` with none. */
export function filesCounted(parts: readonly (readonly [number, string])[]): string | null {
  const named = parts
    .filter(([n]) => n > 0)
    .map(([n, word], i) => `${i === 0 ? plural(n, "test file") : n} ${word}`);
  const last = named.pop();
  if (last === undefined) return null;
  return named.length === 0 ? last : `${named.join(", ")} and ${last}`;
}

/**
 * Spec 005 D2's text for paths that select nothing; row 011-27 (gh-39): with
 * the directory each was resolved against and, when the same path from the
 * worktree root is a listed test file, that file, which it never selects.
 */
export function unmatchedText(selection: NamedSelection): string {
  return selection.unmatchedPaths
    .map((p) => {
      const base =
        p.base === undefined || (p.base === "" && p.given === p.resolved)
          ? ""
          : ` (${p.given}, resolved against ${p.base === "" ? "the worktree root" : p.base})`;
      const root =
        p.fromRoot === undefined
          ? ""
          : `; from the worktree root that path is the listed test file ${p.fromRoot}`;
      return `no test file's closure holds ${p.resolved}${base}${root}`;
    })
    .join("; ");
}

/** The selected files' known failures, each as status lists it (spec 005 D2: "in full"). */
export function namedFailures(
  files: readonly TestFileRef[],
  knownFailures: StatusSnapshot["knownFailures"],
): string[] {
  const ids = new Set(files.map(testFileId));
  return knownFailures
    .filter((f) => ids.has(testFileKeyOf(f.check)))
    .flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...(f.summary === "" ? [] : [`        ${f.summary}`]),
      `        ${[
        ...(f.location === null ? [] : [atText(f.location, undefined)]),
        `observed at revision ${f.observedAt}`,
        f.validity,
      ].join(", ")}`,
    ]);
}

/**
 * One selected file in `NamedWaitPayload.testFiles` (011 C15, issue 23): its
 * class, its verdict when it is `current` or `stale` (the last stored), and
 * for one without a current result the reason the text gives and, row
 * 011-27, its own next step and command.
 */
export interface NamedFileEntry extends TestFileRef {
  readonly state: FileClass;
  readonly verdict?: NamedVerdict;
  readonly reason?: string;
  /** Row 011-27: what advances it, in words with its command; absent when nothing is needed. */
  readonly next?: string;
  /** Row 011-27: that command alone, with its path, when there is one. */
  readonly command?: string;
  /** Row 011-209 (F4): how many test files of its run ended, once the runner named one. */
  readonly ended?: number;
  /** Row 011-209 (F2, F3): its daemon's last yield in its lane, as its line names it. */
  readonly lastYield?: LastYield;
  /** Row 011-268: its named wait's batch, its place and its tier's estimated end, as its line names it. */
  readonly batch?: BatchPlace;
  /** Row 011-274 (gh-111): its runner reported it ended while its tier runs, as its line names it. */
  readonly fileEnd?: FileEnd;
}

export function fileEntry(f: NamedFile, command: string, base?: string): NamedFileEntry {
  const { project, path } = f.testFile;
  const named = fromBase(base, path);
  const standing = standingOf(f);
  const next = standing === undefined ? null : withFileEnd(namedStep(standing), f.end);
  const reason =
    f.unknown !== undefined
      ? `${f.unknown.ran ? "ran, nothing recorded" : "no result"}: ${f.unknown.reason ?? "no reason was kept"}`
      : next === null
        ? undefined
        : reasonWords(next, [named], command);
  const step = next === null ? "" : stepText(next.step, [named], command);
  const run = next === null ? null : stepCommand(next.step, [named], command);
  return {
    project,
    path,
    state: f.state,
    ...(f.verdict === undefined ? {} : { verdict: f.verdict }),
    ...(reason === undefined ? {} : { reason }),
    ...(step === "" ? {} : { next: step }),
    ...(run === null ? {} : { command: run }),
    ...yieldFields(standing),
    ...(f.end === undefined ? {} : { fileEnd: f.end }),
  };
}

/** The data behind a running or queued line's tier words (rows 011-209, 011-268), for `--json`. */
function yieldFields(
  standing: Standing | undefined,
): Pick<NamedFileEntry, "ended" | "lastYield" | "batch"> {
  if (standing?.kind !== "running" && standing?.kind !== "queued") return {};
  const ended = standing.kind === "running" ? standing.ended : undefined;
  return {
    ...(ended === undefined ? {} : { ended }),
    ...(standing.lastYield === undefined ? {} : { lastYield: standing.lastYield }),
    ...(standing.batch === undefined ? {} : { batch: standing.batch }),
  };
}
