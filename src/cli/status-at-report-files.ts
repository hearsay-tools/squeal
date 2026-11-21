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
  if (origin.kind === "commit") return "run in the commit's worktree";
  if (origin.kind === "run") {
    if (origin.stored === true) return "run by this command, stored";
    // The third look: a stop before the record said whether the gate kept it.
    if (maybeStoredText(origin.notStored)) return `run by this command; ${MAYBE_STORED}`;
    return "run by this command, not stored";
  }
  return `run in worktree ${(origin.worktreeId ?? "").slice(0, 8)}`;
}

function word(side: SideState): string {
  // Row 023-29 (R3): the group and the failure, never the budget.
  if (side.state === "not run" && side.reason === "setup")
    return `not run (the batch's setup failed: ${side.setup ?? "no text"})`;
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

/** Why a not-selected file is not vouched for, after "not selected by the change". */
const EXCEPTED_TEXT = {
  incomplete: ", but the static closure is incomplete",
  unchecked: ", and its runner does not tell whether the static closure is complete",
  // Review wave-20 B5: the selection read `<commit>..HEAD`, not the working tree.
  dirty: ", but uncommitted changes in the working tree may reach it",
} as const;

/**
 * What a file's line says after its path: both sides, then their details.
 * Row 023-29 (R8): a file `--run` did not select says so at its commit
 * side, for one file (`many` false) or a group.
 */
function changeText(f: FileReport, at: string, many = false): string {
  // Row 023-34 (T4): both sides from this call's runs, which the gate did not keep.
  if (thisRunOnly(f)) {
    const failed = [f.at, f.now].flatMap((s) => (s.state === "fail" ? [s.failed.join(", ")] : []));
    const more = failed.length === 0 ? "" : `; failed: ${failed.join("; ")}`;
    return `${f.at.state} -> ${f.now.state} (this run, not stored${more})`;
  }
  const parts = [detail(`at ${at}`, f.at), detail("now", f.now)].filter((p) => p !== null);
  const more = parts.length === 0 ? "" : ` (${parts.join("; ")})`;
  if (f.at.state === "no result" && f.at.notSelected === true) {
    const runs = `\`--all-missing\` runs ${many ? "them" : "it"}`;
    // Row 023-35 (T2): not selected, yet its closure may hold a changed input.
    const why = EXCEPTED_TEXT[excepted(f) ?? "unchecked"];
    return `no result at ${at}, not selected by the change${why}; ${runs}; now ${word(f.now)}${more}`;
  }
  return `${word(f.at)} -> ${word(f.now)}${more}`;
}

/** Row 023-34 (T4): both sides are passes or fails of this call's runs that the store does not hold. */
function thisRunOnly(f: FileReport): boolean {
  return [f.at, f.now].every(
    (s) =>
      (s.state === "pass" || s.state === "fail") &&
      s.origin.kind === "run" &&
      s.origin.stored === false &&
      !maybeStoredText(s.origin.notStored),
  );
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
  // T4: an unchanged file compared only from this call's runs says so; the next call cannot.
  for (const f of files.filter((file) => file.change === "unchanged" && thisRunOnly(file)))
    lines.push(`${f.ref.path}: ${changeText(f, at)}`);
  const groups = new Map<string, FileReport[]>();
  for (const f of files.filter((file) => file.change === "unknown" && !unchangeable(file))) {
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
    const many = changeText(group[0] as FileReport, at, true);
    lines.push(`${group.length} test files: ${many}: ${listPaths(paths, GROUP_SHOWN)}`);
  }
  const fixed = notSelectedLines(files, at, full);
  lines.push(...fixed.lines);
  return { lines, folded: folded || fixed.folded };
}

/**
 * Row 023-35 (T2; round 5: 10 of 10 sessions read "not selected by the
 * change" as "not compared"): the files the commit cannot change, on one
 * line with their count and a few paths (each on its own line with `full`),
 * and the not-selected files excepted from that, by why.
 */
function notSelectedLines(
  files: readonly FileReport[],
  at: string,
  full: boolean,
): { readonly lines: string[]; readonly folded: boolean } {
  const paths = files.filter(unchangeable).map((f) => f.ref.path);
  if (paths.length === 0) return { lines: [], folded: false };
  const one = paths.length === 1;
  const reasons = files.map(excepted);
  const incomplete = reasons.filter((r) => r === "incomplete").length;
  const unchecked = reasons.filter((r) => r === "unchecked").length;
  const dirty = reasons.filter((r) => r === "dirty").length;
  const the = (n: number) => (n === 1 ? "the one" : `the ${n}`);
  const parts = [
    ...(incomplete === 0 ? [] : [`${the(incomplete)} with an incomplete static closure`]),
    ...(unchecked === 0
      ? []
      : [
          `${the(unchecked)} whose runner does not tell whether ${unchecked === 1 ? "its" : "their"} static closure is complete`,
        ]),
    ...(dirty === 0
      ? []
      : [`${the(dirty)} that uncommitted changes in the working tree may reach`]),
  ];
  const except =
    parts.length === 0
      ? ""
      : ` (${parts.join(" and ")} excepted; \`--json\` lists them in notSelected.excepted)`;
  const head = `${one ? "1 test file" : `${paths.length} test files`} not selected: none of ${one ? "its" : "their"} inputs differs between ${at} and the working tree, so this commit cannot change ${one ? "its" : "their"} result${except}`;
  if (full) return { lines: [head, ...paths.map((path) => `  ${path}`)], folded: false };
  const folded = paths.length > GROUP_SHOWN;
  return { lines: [`${head}: ${listPaths(paths, GROUP_SHOWN)}`], folded };
}

/**
 * Row 023-35 (T2): a file with no result at the commit that the change did
 * not select, and whose static closure its runner told complete: none of
 * its inputs differs, so the commit cannot change its result.
 */
export const unchangeable = (f: FileReport) =>
  f.at.state === "no result" && f.at.notSelected === true && f.at.closure === "complete";

/** T2: a file the change did not select that the report cannot vouch for, with why. */
export function excepted(f: FileReport): "incomplete" | "unchecked" | "dirty" | null {
  if (f.at.state !== "no result" || f.at.notSelected !== true) return null;
  return f.at.closure === "complete" ? null : (f.at.closure ?? "unchecked");
}

/**
 * T2's JSON: how many files the commit cannot change, and each file the
 * change did not select that is excepted, with why.
 */
export function notSelectedJson(files: readonly FileReport[]) {
  return {
    files: files.filter(unchangeable).length,
    excepted: files.flatMap((f) => {
      const why = excepted(f);
      return why === null ? [] : [{ project: f.ref.project, path: f.ref.path, closure: why }];
    }),
  };
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
