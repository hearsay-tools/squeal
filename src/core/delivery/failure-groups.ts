import { retryText } from "../retry/index.js";
import { FLAKY_INPUTS_TEXT, flakyText, SUMMARY_MAX_CHARS } from "../state/index.js";
import { checkPartsText, countChecks } from "../status/checks.js";
import { atText } from "../status/test-frame.js";
import { cap, plural, shellWord } from "../text.js";
import type { FlakyNote, TransitionEntry } from "../types/index.js";
import { type Collapsed, nameLines } from "./collapse.js";
import { seenLine, touchesLine } from "./provenance.js";

/*
 * Row 011-109 (gh-71, digest 2026-10-22 group D): 91 checks that failed with
 * one first error at one location were 91 blocks, each with the same error,
 * cut at the cap. Failures whose blocks state the same change, run, error,
 * location, flaky note and retry read as one block: their count, every line
 * they share, their names or test files (`nameLines`), and one `squeal
 * failures` command for each check's evidence. A failure with no error text
 * is never grouped.
 */

/** Test files the command names before it names their common directory. */
const FILES_NAMED = 3;

/** Characters of the error's first line the command selects by; a part selects as the whole. */
const ERROR_CHARS = 120;

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A report's flaky note lines (`flakyLines`), called in the order its blocks print. */
export type FlakyLines = (note: FlakyNote | undefined) => string[];

/**
 * Row 011-244 (gh-98): each block's flaky note line; the first a report
 * prints is followed by `FLAKY_INPUTS_TEXT`, so the report points to
 * `inputs` once however many notes it names.
 */
export function flakyLines(): FlakyLines {
  let pointed = false;
  return (note) => {
    if (note === undefined) return [];
    const line = capitalize(flakyText(note));
    if (pointed) return [line];
    pointed = true;
    return [line, FLAKY_INPUTS_TEXT];
  };
}

/** What a failure's block states beside its name, its test-file frame, its closure and its load. */
function groupKey(entry: TransitionEntry, revision: number): string | null {
  if (entry.summary === null) return null;
  return JSON.stringify([
    seenLine(entry, revision),
    entry.summary,
    entry.location === null ? null : atText(entry.location, undefined),
    entry.flaky === undefined ? null : flakyText(entry.flaky),
    entry.retry === undefined ? null : retryText(entry.retry),
  ]);
}

/** `failures` in groups that share their key, each where its first failure was, singles alone. */
export function failureGroups(
  failures: readonly TransitionEntry[],
  revision: number,
): TransitionEntry[][] {
  const byKey = new Map<string, TransitionEntry[]>();
  const groups: TransitionEntry[][] = [];
  for (const failure of failures) {
    const key = groupKey(failure, revision);
    const group = key === null ? undefined : byKey.get(key);
    if (group !== undefined) {
      group.push(failure);
      continue;
    }
    const fresh = [failure];
    if (key !== null) byKey.set(key, fresh);
    groups.push(fresh);
  }
  return groups;
}

/** The line every failure of `group` states, `null` when one differs or none states one. */
function shared(
  group: readonly TransitionEntry[],
  line: (e: TransitionEntry) => string | null,
): string | null {
  const lines = group.map(line);
  return lines.every((l) => l === lines[0]) ? (lines[0] ?? null) : null;
}

/** The loads a group of timeouts ran under, one or their range. */
function loadsLine(group: readonly TransitionEntry[]): string | null {
  const loads = group.flatMap((e) => (e.loadAverage === undefined ? [] : [e.loadAverage]));
  if (loads.length === 0) return null;
  const [low, high] = [Math.min(...loads), Math.max(...loads)].map((l) => l.toFixed(2));
  return `load average ${low === high ? low : `${low} to ${high}`} when they ran`;
}

/** The deepest directory holding every one of `paths`; `""` for the worktree's root. */
function commonDirectory(paths: readonly string[]): string {
  const split = paths.map((p) => p.split("/").slice(0, -1));
  const first = split[0] ?? [];
  let depth = 0;
  while (depth < first.length && split.every((s) => s[depth] === first[depth])) depth++;
  return first.slice(0, depth).join("/");
}

/**
 * The `squeal failures` command that lists every check of `group`: the
 * failures with its error, each check's newest once, all of them, in its test
 * files up to `FILES_NAMED`, else the directory holding them, and in every
 * worktree when they were inherited. Review 0.1.262 B1: the files and a
 * limit of the group's size listed other, newer failures in its place.
 */
function failuresCommand(group: readonly TransitionEntry[], command: string): string {
  const first = group[0] as TransitionEntry;
  const files = [...new Set(group.map((e) => e.check.testPath))];
  const selected = files.includes("")
    ? []
    : files.length <= FILES_NAMED
      ? files
      : [commonDirectory(files)].filter((d) => d !== "");
  const error = Array.from((first.summary ?? "").split("\n")[0] ?? "")
    .slice(0, ERROR_CHARS)
    .join("");
  return [
    `${command} failures`,
    ...selected.map(shellWord),
    ...(error === "" ? [] : [`--error ${shellWord(error)}`]),
    "--per-check --limit all",
    ...(first.origin.kind === "inherited" ? ["--all-worktrees"] : []),
  ].join(" ");
}

/** One block for a group of more than one failure: its head and lines, as `collapse` gives them. */
export function groupLines(
  group: readonly TransitionEntry[],
  revision: number,
  command: string,
  flaky: FlakyLines,
): Collapsed {
  const first = group[0] as TransitionEntry;
  const checks = group.map((e) => e.check);
  const at = (e: TransitionEntry) =>
    e.location === null ? null : atText(e.location, e.testFileFrame);
  const lines = [
    seenLine(first, revision),
    cap(first.summary ?? "", SUMMARY_MAX_CHARS),
    first.location === null ? null : (shared(group, at) ?? atText(first.location, undefined)),
    shared(group, touchesLine),
    loadsLine(group),
    ...flaky(first.flaky),
    first.retry === undefined ? null : capitalize(retryText(first.retry)),
    ...nameLines(checks, "that did not load"),
    `Full list: ${failuresCommand(group, command)}`,
  ];
  return {
    head: `FAIL  ${plural(group.length, "check")} with one error and location (${checkPartsText(countChecks(checks), "that did not load")})`,
    lines: lines.filter((l): l is string => l !== null),
  };
}
