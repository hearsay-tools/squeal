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
import { testFileText } from "../core/text.js";
import type { StatusSnapshot, TestFileRef } from "../core/types/index.js";
import type { NamedFile, NamedVerdict } from "./named-files.js";
import type { NamedSelection, UnmatchedPath } from "./named-selection.js";
import type { FileClass } from "./verdict.js";

/*
 * Task 011-12 (011 C15, issues 17 and 23): the text a named wait gives each
 * selected file. A block per class groups them, each pending, stale or
 * unknown group with what holds it and, row 011-27 (C15 as amended
 * 2026-10-20), what advances it (`nextStep`); each current one with its
 * verdict. The verdict line counts the groups, each with its command.
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
  const groups = new Map<string, { files: TestFileRef[]; standing?: Standing; words: string }>();
  for (const f of files) {
    const standing = standingOf(f);
    const id = standing === undefined ? `verdict ${f.verdict}` : groupId(standing);
    const group = groups.get(id);
    if (group === undefined) {
      const words = f.verdict ?? "not listed in this worktree";
      groups.set(id, {
        files: [f.testFile],
        ...(standing === undefined ? {} : { standing }),
        words,
      });
      continue;
    }
    group.files.push(f.testFile);
    if (standing !== undefined && group.standing !== undefined) {
      group.standing = widest(group.standing, standing);
    }
  }
  return [...groups.values()].map(({ files: refs, standing, words }) => ({
    files: refs,
    next: standing === undefined ? null : nextStep(standing),
    words,
  }));
}

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
 * Spec 005 D2's text for paths that select nothing; row 011-27 (gh-39): with
 * the directory each was resolved against and, when the same path from the
 * worktree root is a listed test file, that file, which it never selects.
 */
export function unmatchedText(selection: NamedSelection): string {
  const paths: readonly UnmatchedPath[] =
    selection.unmatchedPaths ??
    selection.unmatched.map((resolved) => ({ resolved, given: resolved }));
  return paths
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
}

export function fileEntry(f: NamedFile, command: string, base?: string): NamedFileEntry {
  const { project, path } = f.testFile;
  const named = fromBase(base, path);
  const standing = standingOf(f);
  const next = standing === undefined ? null : nextStep(standing);
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
  };
}
