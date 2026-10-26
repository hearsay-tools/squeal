import { formatStatus } from "../core/status/index.js";
import type { EpochMs, TestFileRef } from "../core/types/index.js";
import type { CliIo } from "./main.js";
import { fileEntry, type NamedFileEntry } from "./named-file-lines.js";
import { namedPathLines } from "./named-path-lines.js";
import type { NamedPath } from "./named-selection.js";
import { statusCommand } from "./status-command.js";
import { type AskedPayload, askedLines, askedPayload } from "./status-wait-ask-lines.js";
import { CheckUsageError } from "./status-wait-focus.js";
import {
  type FocusedPayload,
  focusLines,
  focusPayload,
  refusedLine,
} from "./status-wait-focus-lines.js";
import {
  type NamedTextOptions,
  namedClassLines,
  namedLine,
  namedText,
  selectedLine,
} from "./status-wait-lines.js";
import {
  type NamedWait,
  type NamedWaitOptions,
  type NamedWaitOutcome,
  namedResult,
  waitForNamed,
} from "./status-wait-paths.js";
import { sessionOf } from "./store-writes.js";
import {
  type FileVerdict,
  type NoVerdictReason,
  resultCode,
  type SelectionWord,
} from "./verdict.js";

/*
 * The named wait's command and how a named wait or snapshot prints (spec
 * 005 D2, row 011-28): its lines, or with `--json` its payload. Row 011-241
 * moved them from `status-wait-paths.ts`, which keeps the wait.
 */

/**
 * The `selection` field both `status --json --wait <ms> <path>...` and
 * `status --json <path>...` add to the snapshot (row 011-63, gh-65), whose
 * outcome is `snapshot` for the latter; also the wait's `wait` field and the
 * snapshot's `named` field (row 011-28), kept.
 */
export interface NamedWaitPayload {
  readonly outcome: NamedWaitOutcome | "snapshot";
  readonly waitedMs: number;
  readonly code: 0 | 1 | 3;
  /** Row 011-206 (gh-88, gh-84): `code` as a word, from `namedResult`, as the text says it. */
  readonly result: SelectionWord;
  /** Row 011-206: with `none`, the one reason from the closed list (`NoVerdictReason`). */
  readonly reason?: NoVerdictReason;
  readonly testFiles: readonly NamedFileEntry[];
  readonly unmatched: readonly string[];
  /** Row 011-206 (gh-83): each named path with how it was read. */
  readonly paths: readonly NamedPath[];
  /** The selected slow files it did not hold for, waiting for a pause or `run --slow` (task 004-78). */
  readonly leftForPause: readonly TestFileRef[];
  readonly verdict: FileVerdict;
  /** Row 011-146: with `--check`, the focused answers (011 C15, additive). */
  readonly focused?: FocusedPayload;
  /** Row 011-207: the runs the wait asked, its stored requests only (011 C15, additive); absent with none. */
  readonly asked?: readonly AskedPayload[];
}

/** How a named wait or snapshot prints (`printNamed`). */
export interface NamedPrint extends NamedTextOptions {
  readonly json: boolean;
}

/** `{ asked }` when the wait stored a request, else nothing (review 0.1.322 B3). */
function withAsked(asked: readonly AskedPayload[] | undefined) {
  return asked === undefined ? {} : { asked };
}

/**
 * `squeal status [--json] [--full] --wait <ms> <path>...` (spec 005 D2):
 * the wait, then `printNamed`.
 */
export async function namedWaitCommand(
  paths: readonly string[],
  how: NamedPrint,
  io: CliIo,
  options: NamedWaitOptions,
): Promise<number> {
  const checks = how.checks ?? [];
  // Row 011-207: its requests name the session, as `retry`'s do.
  const asker = options.asker ?? sessionOf(io);
  const wait = waitForNamed(io.cwd ?? process.cwd(), paths, { ...options, checks, asker });
  return printNamed(wait, how, io, options.now);
}

/**
 * Prints a named wait or snapshot (005 D2 as amended 2026-10-20, row
 * 011-28): the revision line, or with `--full` the worktree's status, then
 * the line naming the selected files and their failures in full, then last
 * the verdict on them (issue 26); with `--json` the naming and verdict lines
 * go to stderr and stdout is the snapshot plus a `selection` field
 * (`NamedWaitPayload`) in both forms (row 011-63, gh-65), and the same
 * payload under `wait`, or `named` for a snapshot, as before. Returns D1's
 * code for the selected files only: 0, 1 with known failures among them, 3
 * without a verdict, an unreadable store included; 2 for a `CheckUsageError`
 * (row 011-146, C15).
 */
export async function printNamed(
  read: Promise<NamedWait>,
  how: NamedPrint,
  io: CliIo,
  now: () => EpochMs,
): Promise<number> {
  let wait: NamedWait;
  try {
    wait = await read;
  } catch (error) {
    if (!(error instanceof CheckUsageError)) throw error;
    io.stderr(`squeal status: ${error.message}\n`);
    return 2;
  }
  if (wait.outcome === "unavailable") {
    const { result } = wait;
    io.stdout(how.json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, now()));
    return 3;
  }
  const result = namedResult(wait);
  const code = resultCode(result);
  const command = statusCommand(io.env ?? process.env);
  if (!how.json) {
    io.stdout(namedText(wait, now(), command, how));
    return code;
  }
  const payload: NamedWaitPayload = {
    outcome: wait.snapshot === true ? "snapshot" : wait.outcome,
    waitedMs: Math.round(wait.waitedMs),
    code,
    result: result.result,
    ...(result.result === "none" ? { reason: result.reason } : {}),
    testFiles: wait.files.map((f) => fileEntry(f, command, wait.selection.base)),
    unmatched: wait.selection.unmatched,
    paths: wait.selection.paths,
    leftForPause: wait.leftForPause ?? [],
    verdict: wait.verdict,
    ...(wait.focus === undefined ? {} : { focused: focusPayload(wait.focus) }),
    ...withAsked(askedPayload(wait.asked)),
  };
  const field = wait.snapshot === true ? "named" : "wait";
  const json = { ...wait.result, [field]: payload, selection: payload };
  io.stdout(`${JSON.stringify(json, null, 2)}\n`);
  const selected = selectedLine(wait);
  const refused = refusedLine(wait.focus);
  const lines = [
    ...(refused === null ? [] : [refused]),
    ...(selected === null ? [] : [selected]),
    ...namedPathLines(wait.selection),
    ...askedLines(wait.asked, command, wait.selection.base),
    ...focusLines(wait.focus, wait.selection.base),
    ...namedClassLines(wait, command),
  ];
  io.stderr(`${lines.map((line) => `${line}\n`).join("")}${namedLine(wait, command)}\n`);
  return code;
}
