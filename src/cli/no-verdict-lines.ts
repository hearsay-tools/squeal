import { testFileId } from "../core/keys/index.js";
import { fromBase, PATHS_IN_COMMAND } from "../core/status/next-step-text.js";
import { shellWord } from "../core/text.js";
import type { StatusSnapshot } from "../core/types/index.js";
import { coverText, filesCounted, reasonGroups } from "./named-file-lines.js";
import type { SyncState } from "./status-sync.js";
import type { EndedNamed } from "./status-wait-lines.js";
import { type NoVerdictReason, noVerdictText, type SelectionResult } from "./verdict.js";

/*
 * Row 011-243 (gh-99; 011 C15): the clause of a named wait or snapshot with
 * no verdict, which says what revision its passes ran at, and the step it
 * ends with, the command to wait again, so the agent neither runs the files
 * by hand nor takes the passes it lists for the verdict. The clause moved
 * here from `status-wait-lines.ts`.
 */

/**
 * Row 011-250 (gh-1): why a wait whose last read found no daemon record
 * while a daemon held the worktree's lock has no verdict; it names no
 * `squeal start`, which would only wait for that daemon.
 */
export const LOCKED_TEXT =
  "a daemon holds this worktree's lock but does not serve yet: it is starting or stopping";

/**
 * Row 011-206 (011 C15): the clause of a read with no verdict by the reason
 * `namedResult` gives it: a lapsed heartbeat, the daemon's pass not stored
 * (`unsyncedText`), the revision not listed (`unlistedText`), else the files
 * still held by what holds them, or a focused run with every file current.
 * Row 011-243 (gh-99): before the pass not stored or the revision not
 * listed, what the current files passed at, which those may not cover.
 */
export function timeoutText(wait: EndedNamed, result: SelectionResult, command: string): string {
  const { verdict } = wait;
  const reason = result.result === "none" ? result.reason : null;
  if (reason === "lapsed") {
    const why =
      wait.locked === true ? LOCKED_TEXT : "the daemon's heartbeat had lapsed at the last read";
    return `${why}; results are as of revision ${verdict.revision}`;
  }
  const paused = new Set((wait.leftForPause ?? []).map(testFileId));
  const holding = wait.files.filter((f) => !paused.has(testFileId(f.testFile)));
  const these =
    holding.filter((f) => f.state === "current").length === 1 ? "this result" : "these results";
  // Quality 2026-10-26-a slice 1: `unsynced` (verdict.ts) decides; this picks the words.
  if (reason === "unsynced") {
    const cover = coverText(holding, verdict.revision);
    const why = unsyncedText(
      wait.sync,
      verdict.revision,
      wait.snapshot === true,
      cover === null ? null : these,
    );
    return cover === null ? why : `${cover}; ${why}`;
  }
  if (reason === "unlisted") {
    const listed = wait.result.refinedRevision;
    const cover = coverText(holding, listed != null && listed < verdict.revision ? listed : null);
    const why = unlistedText(wait.result, verdict.revision, cover === null ? null : these);
    const groups = reasonGroups(holding, command, wait.selection.base);
    const said = cover === null ? why : `${cover}; ${why}`;
    return groups === "" ? said : `${said}: ${groups}`;
  }
  const groups = reasonGroups(holding, command, wait.selection.base);
  const why = noVerdictText(verdict);
  return why === null ? "no result yet" : groups === "" ? why : `${why}: ${groups}`;
}

/**
 * Review wave-1, B1: the words for a named wait's deadline that came before
 * the revision holding the edits made before it, which `unsynced` decides; a
 * snapshot's sync, after its 750 ms (row 011-28), or one the daemon could
 * not answer (review of cand/0.1.233, B1). Row 011-243: with `these`, after
 * the current files' passes, which those may not cover.
 */
function unsyncedText(
  sync: SyncState,
  revision: number,
  snapshot: boolean,
  these: string | null,
): string {
  if (sync.state === "synced") {
    return these === null
      ? `the daemon's pass is at revision ${sync.revision} and results are as of revision ${revision}`
      : `the daemon's pass is at revision ${sync.revision}, so ${these} may not cover it`;
  }
  if (sync.state === "unsupported") {
    return these === null
      ? `results are as of revision ${revision}; the daemon did not answer its sync, so they may not hold the latest edits`
      : `the daemon did not answer its sync, so ${these} may not hold the latest edits`;
  }
  const pass = `the daemon has not stored its pass over ${snapshot ? "the latest edits" : "the edits made before the wait"}`;
  if (these !== null) return `${pass}, so ${these} may not cover them`;
  return snapshot
    ? `results are as of revision ${revision}; ${pass}`
    : `${pass}; results are as of revision ${revision}`;
}

/**
 * Row 011-243 (gh-99): `revision 7 is not listed yet (677 test files
 * queued), so these results may not cover it`, the worktree's pending files
 * counted, which the listing waits behind; with `these`, after the current
 * files' passes at the last revision the runner listed.
 */
function unlistedText(snapshot: StatusSnapshot, revision: number, these: string | null): string {
  const { running = 0, queued = 0 } = snapshot.testFilesByPhase ?? {};
  const counted = filesCounted([
    [running, "running"],
    [queued, "queued"],
  ]);
  const not = `revision ${revision} is not listed yet${counted === null ? "" : ` (${counted})`}`;
  return these === null ? not : `${not}, so ${these} may not cover it`;
}

/** The deadline a snapshot's next wait names, the wait Squeal's other texts name. */
export const WAIT_AGAIN_MS = 60_000;

/** The reasons a later read can end: the daemon runs, lists or stores what holds the verdict. */
const WAITED: ReadonlySet<NoVerdictReason> = new Set(["lapsed", "unsynced", "unlisted", "pending"]);

/**
 * `. A later pass is not reported. A failure arrives with a later tool
 * call. For the verdict, wait again: \`squeal status --wait 60000 a.test.ts\``,
 * last on the verdict line, so a `tail -1` keeps the command (row 011-27); with
 * no daemon, the wait once one runs, since nothing arrives before. Empty with
 * a verdict, and for a reason whose line names its own step: a hold, a pause,
 * a focused answer, a file nothing queues, a path that selects nothing.
 */
export function waitAgainText(wait: EndedNamed, result: SelectionResult, command: string): string {
  if (result.result !== "none") return "";
  const again = wait.snapshot === true ? "wait" : "wait again";
  if (result.reason === "no-daemon") {
    return `. For the verdict, ${again} once a daemon runs: \`${waitAgainCommand(wait, command)}\``;
  }
  if (!WAITED.has(result.reason)) return "";
  return (
    ". A later pass is not reported. A failure arrives with a later tool call. " +
    `For the verdict, ${again}: \`${waitAgainCommand(wait, command)}\``
  );
}

/**
 * The same wait: its deadline (`WAIT_AGAIN_MS` for a snapshot, or a wait
 * that does not carry its own), its paths from the directory they were
 * given in, `<same paths>` past `PATHS_IN_COMMAND` (011 C15 as amended
 * 2026-10-20), and its `--check` texts.
 */
export function waitAgainCommand(wait: EndedNamed, command: string): string {
  const ms = wait.snapshot === true ? WAIT_AGAIN_MS : (wait.timeoutMs ?? WAIT_AGAIN_MS);
  const named = wait.selection.paths.map((p) => p.path);
  const paths =
    named.length > PATHS_IN_COMMAND
      ? "<same paths>"
      : named
          .map((p) => shellWord(p.startsWith("/") ? p : fromBase(wait.selection.base, p)))
          .join(" ");
  const checks = (wait.focus?.texts ?? []).map((t) => ` --check ${shellWord(t)}`).join("");
  return `${command} status --wait ${ms} ${paths}${checks}`;
}
