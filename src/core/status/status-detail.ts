import { plural } from "../text.js";
import type { DaemonNote, EpochMs, StatusSnapshot } from "../types/index.js";
import { partsSuffix } from "./checks.js";
import { DEATH_CAUSE, deathText } from "./died.js";
import { shortCommit, worktreeLine } from "./identity.js";
import { shortText, stoppingText } from "./stopping.js";
import { unknownFilesLines } from "./unknown-files.js";

/*
 * Row 011-29 (011 C6 as amended 2026-10-20; `tasks/011-24/design.md` 1.2):
 * the detail block `squeal status --full` adds after the default text, as
 * status printed it before: the worktree, the daemon, inheritance and its
 * sources, the test files without checks and without a result, the closure
 * method, the store schema and the notes.
 */

/** The detail block's lines; `allNotes` is `--notes` (task 001-222). */
export function detailLines(
  s: StatusSnapshot,
  now: EpochMs,
  command: string,
  allNotes: boolean,
): string[] {
  return [
    worktreeLine(s),
    daemonLine(s, now, command),
    inheritedLine(s),
    ...s.inherited.sources.map(
      (source) =>
        `  ${source.count}${partsSuffix(source.count, source.fileLevelCount)} from ${source.worktreeRoot ?? source.worktreeId} at ${shortCommit(source.commit)}`,
    ),
    ...(s.breakdown.testFilesWithoutChecks === 0
      ? []
      : [
          `Test files without checks: ${s.testFilesWithoutChecks.pending} pending, ${s.testFilesWithoutChecks.unknown} unknown`,
        ]),
    ...unknownFilesLines(s),
    `Closure method: ${s.closureMethod}`,
    `Store schema: ${s.storeSchemaVersion}`,
    ...notesLines(s, command, allNotes),
  ];
}

/**
 * The `More:` line's parts (design 1.1, item 8): what the detail block
 * holds beyond the worktree and daemon, each only with content.
 */
export function hiddenParts(s: StatusSnapshot, command: string): string[] {
  const sources = new Set(s.inherited.sources.map((source) => source.worktreeId)).size;
  const unknown = s.unknownTestFiles?.total ?? 0;
  const notes = Math.max(0, notesLines(s, command, false).length - 1);
  return [
    "the worktree and daemon",
    ...(s.inherited.count === 0
      ? []
      : [
          `the ${plural(s.inherited.count, "current result")} inherited from ${plural(sources, "worktree")}`,
        ]),
    ...(unknown === 0 ? [] : [`the ${plural(unknown, "test file")} without a result one by one`]),
    ...(notes === 0 ? [] : [plural(notes, "note")]),
  ];
}

/**
 * Says where current results come from, and at 0 that none was reused, so the
 * line never reads as nothing being current (lessons, defect 27).
 */
function inheritedLine(s: StatusSnapshot): string {
  return s.inherited.count === 0
    ? "Inherited from other worktrees: none (every current result here was run in this worktree)"
    : `Inherited from other worktrees: ${plural(s.inherited.count, "current result")}${partsSuffix(s.inherited.count, s.inheritedFileLevelCount)}`;
}

function daemonLine(s: StatusSnapshot, now: EpochMs, command: string): string {
  // Row 011-34: a stopping daemon is neither running nor gone.
  const { stopping } = s.daemon;
  if (stopping !== undefined) {
    return `Daemon: ${stoppingText(stopping, command, ageText(now - stopping.since))}`;
  }
  if (s.daemon.state === "alive") {
    const running = `Daemon: running, last heartbeat ${ageText(now - s.daemon.lastHeartbeatAt)} ago`;
    // Row 011-140: one that ended its handoff short says so, and what replaces it.
    return s.daemon.short === undefined
      ? running
      : `${running}; ${shortText(s.daemon.short, command)}`;
  }
  // Task 011-08: `squeal stop` holds until the next edit or `squeal start`.
  if (s.daemon.stopped === true) {
    return `Daemon: stopped by request (\`${command} stop\`); a hook starts one at the next edit, or run \`${command} start\`. ${holdAcrossEditsText(command)}`;
  }
  const since =
    s.daemon.since === null
      ? "Daemon: no daemon running"
      : `Daemon: no daemon running since ${new Date(s.daemon.since).toISOString()}`;
  // Row 011-251 (the coordinator, 2026-10-26): a mark beside the lock says one starts.
  const down = s.daemon.startingSince === undefined ? since : `${since}; a daemon is starting`;
  // Task 001-263: a daemon that died without its stop note is named, with what it was running.
  if (s.daemon.died === undefined) return down;
  return `${down}; it ${deathText(s.daemon.died)}. ${DEATH_CAUSE}`;
}

/**
 * Row 011-211 (gh-90): an edit ends a stop, not a hold, so a stop's line
 * names the hold for a manual run across edits. A sentence.
 */
export function holdAcrossEditsText(command: string): string {
  return `For a manual run across edits, \`${command} hold -- <command>\` holds validation until the command exits.`;
}

/** `5 s`, `3 min`, `2 h`. */
export function ageText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * Status's own notes, then the daemon's with time and revision. Unless
 * `all`, two or more notes of stopped processes of one kind fold into one
 * line counting them by command (task 001-222); 001-212's detail of each
 * stays behind `status --notes`. So do a daemon's exit notes of one text,
 * one per start of an idle worktree's daemon: the latest is listed with how
 * many there were (task 001-413).
 */
function notesLines(s: StatusSnapshot, command: string, all: boolean): string[] {
  const exits = new Map<string, DaemonNote[]>();
  for (const note of all ? [] : s.daemonNotes) {
    if (note.exitOf !== undefined) exits.set(note.text, [...(exits.get(note.text) ?? []), note]);
  }
  const stamped = (n: DaemonNote) => {
    const at = new Date(n.at).toISOString();
    const text =
      n.revision === null ? `${at}: ${n.text}` : `${at}, revision ${n.revision}: ${n.text}`;
    const same = n.exitOf === undefined ? [] : (exits.get(n.text) ?? []);
    const [first] = same;
    if (same.length < 2 || first === undefined) return text;
    const since = new Date(first.at).toISOString();
    return `${text} (${same.length} notes since ${since}; \`${command} status --notes\` lists each)`;
  };
  const groups = new Map<string, DaemonNote[]>();
  const kept: DaemonNote[] = [];
  for (const note of s.daemonNotes) {
    const exit = note.exitOf === undefined ? undefined : exits.get(note.text);
    if (exit !== undefined && exit[exit.length - 1] !== note) continue;
    const what = all ? undefined : note.stopped?.what;
    if (what === undefined) kept.push(note);
    else groups.set(what, [...(groups.get(what) ?? []), note]);
  }
  const folded: string[] = [];
  for (const [what, list] of groups) {
    const [only] = list;
    if (list.length === 1 && only !== undefined) kept.push(only);
    else folded.push(foldedText(what, list, command));
  }
  kept.sort((a, b) => a.at - b.at);
  const lines = [...s.notes, ...kept.map(stamped), ...folded];
  return lines.length === 0 ? [] : ["Notes:", ...lines.map((note) => `  ${note}`)];
}

function foldedText(what: string, list: readonly DaemonNote[], command: string): string {
  const counts = new Map<string, number>();
  for (const line of list.flatMap((note) => note.stopped?.commands ?? [])) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const byCommand = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([line, n]) => `${n} × ${line}`);
  const since = new Date(Math.min(...list.map((note) => note.at))).toISOString();
  const processes = total === 1 ? "1 process" : `${total} processes`;
  return (
    `stopped ${processes} ${what}, in ${plural(list.length, "note")} since ${since}: ` +
    `${byCommand.join("; ")} (\`${command} status --notes\` lists each)`
  );
}
