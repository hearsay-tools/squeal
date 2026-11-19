import { listPaths, shellWord } from "../core/text.js";
import type { FileReport, Origin, SideState } from "./status-at-report.js";

/*
 * Spec 023 D3 (rows 023-06, 023-19): the text lines of `status --at`'s
 * files. A changed file has a line of its own. Unknown files with the same
 * states on both sides form one group: a small group is listed one file
 * per line, a large one is one line with its count and a few paths (P6:
 * a cold store made the report a wall of `no result` lines). `--full`
 * lists every file, and the JSON report always does. A file new since the
 * commit gets a pointer to `squeal proof` (P8: agents answered a
 * before/after question with a red proof, or missed the new test).
 */

/**
 * Row 023-19 (the third look, accepted limit): the end of a not-stored
 * reason when the run's record could not say whether the gate kept the
 * file; then it may be in the store.
 */
export const MAYBE_STORED = "it may have been stored, and the next status --at shows it";

/** Whether a run's not-stored reason says the result may be stored after all. */
export const maybeStoredText = (reason: string | undefined) =>
  reason?.endsWith(MAYBE_STORED) === true;

/** The most files a group lists one per line, and the paths a larger group names. */
export const GROUP_SHOWN = 3;

const short = (sha: string | null) => (sha === null ? "none" : sha.slice(0, 9));

export function originText(origin: Origin): string {
  if (origin.kind === "ci") return "from CI's export";
  if (origin.kind === "import") return `imported from CI at ${short(origin.commit)}`;
  if (origin.kind === "own") return "run in this worktree";
  if (origin.kind === "run") {
    if (origin.stored === true) return "run by this command, stored";
    // The third look: a stop before the record said whether the gate kept it.
    if (maybeStoredText(origin.notStored)) return `run by this command; ${MAYBE_STORED}`;
    return "run by this command, not stored";
  }
  return `run in worktree ${(origin.worktreeId ?? "").slice(0, 8)}`;
}

function word(side: SideState): string {
  if (side.state === "not comparable" && side.ran !== undefined)
    return `${side.ran} when run, not stored (${side.reason})`;
  if (
    side.state === "not determined" ||
    side.state === "not run" ||
    side.state === "not comparable"
  )
    return `${side.state} (${side.reason})`;
  if (side.state === "no result" && side.pending !== undefined)
    return `no result (${side.pending})`;
  return side.state;
}

function detail(name: string, side: SideState): string | null {
  if (side.state === "fail")
    return `${name}: ${side.failed.join(", ")}; ${originText(side.origin)}`;
  if (side.state === "pass") return `${name}: ${originText(side.origin)}`;
  if (side.state === "not comparable" && side.failed !== undefined)
    return `${name}: ${side.failed.join(", ")}`;
  return null;
}

/** What a file's line says after its path: both sides, then their details. */
function changeText(f: FileReport, at: string): string {
  const parts = [detail(`at ${at}`, f.at), detail("now", f.now)].filter((p) => p !== null);
  const more = parts.length === 0 ? "" : ` (${parts.join("; ")})`;
  return `${word(f.at)} -> ${word(f.now)}${more}`;
}

/**
 * D3's file lines: each changed file, then the unknown files by group,
 * the largest group first; with `full`, every file on a line of its own.
 * The second value tells whether a group was folded into one line.
 */
export function fileLines(
  files: readonly FileReport[],
  at: string,
  full: boolean,
): { readonly lines: string[]; readonly folded: boolean } {
  const lines: string[] = [];
  for (const kind of ["pass -> fail", "fail -> pass"] as const) {
    for (const f of files.filter((file) => file.change === kind))
      lines.push(`${f.ref.path}: ${changeText(f, at)}`);
  }
  const groups = new Map<string, FileReport[]>();
  for (const f of files.filter((file) => file.change === "unknown")) {
    const text = changeText(f, at);
    groups.set(text, [...(groups.get(text) ?? []), f]);
  }
  let folded = false;
  // A stable sort: groups of one size keep the order of their first file's path.
  const ordered = [...groups].sort(([, a], [, b]) => b.length - a.length);
  for (const [text, group] of ordered) {
    if (full || group.length <= GROUP_SHOWN) {
      for (const f of group) lines.push(`${f.ref.path}: ${text}`);
      continue;
    }
    folded = true;
    const paths = group.map((f) => f.ref.path);
    lines.push(`${group.length} test files: ${text}: ${listPaths(paths, GROUP_SHOWN)}`);
  }
  return { lines, folded };
}

/** P8: the files the commit lacks that exist now: new in the range. */
export const isNew = (f: FileReport) => f.at.state === "absent" && f.now.state !== "absent";

/** P8: the command that shows whether a new test fails on the code at `commit`. */
export function proofCommand(path: string, commit: string): string {
  return `squeal proof ${shellWord(path)} --base ${short(commit)}`;
}

/** P8: one line per new test file (a few, or every one with `full`), each naming `squeal proof`. */
export function newFileLines(
  files: readonly FileReport[],
  commit: string,
  full: boolean,
): string[] {
  const fresh = files.filter(isNew);
  const shown = full ? fresh : fresh.slice(0, GROUP_SHOWN);
  const at = short(commit);
  const lines = shown.map(
    (f) =>
      `${f.ref.path} is new since ${at}: \`${proofCommand(f.ref.path, commit)}\` shows whether it fails on the code at ${at}.`,
  );
  const left = fresh.length - shown.length;
  if (left > 0)
    lines.push(
      `${left} more test file${left === 1 ? " is" : "s are"} new since ${at}; \`squeal proof <file> --base ${at}\` does the same for each.`,
    );
  return lines;
}
