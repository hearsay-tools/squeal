import { RECORDED_UNKNOWN_TEXT, recordedText, retryText } from "../retry/index.js";
import { flakyText, SUMMARY_MAX_CHARS } from "../state/index.js";
import {
  checkPartsText,
  checksText,
  countChecks,
  earlierFailuresLines,
  failureCountText,
  knownFailureCounts,
  notCurrentText,
  splitByValidity,
} from "../status/checks.js";
import { holdEndedText, holdEndText, holdStartText } from "../status/holds.js";
import { atText } from "../status/test-frame.js";
import { cap, plural, shellWord } from "../text.js";
import type {
  CheckId,
  DaemonLiveness,
  Delta,
  DeltaEntry,
  EditsSettled,
  HoldChange,
  KnownFailure,
  KnownOutcome,
  Registration,
  RetiredEntry,
  TransitionEntry,
} from "../types/index.js";
import { type Collapsed, checkName, collapse } from "./collapse.js";
import { failureGroups, groupLines } from "./failure-groups.js";
import { type HeaderForm, headerLines } from "./header.js";
import {
  change,
  closureLine,
  loadLine,
  recoveryProvenance,
  seenLine,
  touchesLine,
} from "./provenance.js";

/*
 * Human rendering of deltas and registrations, a separate layer over the
 * versioned payloads (styleguide). Spec 001 D6: "Failures come first. The
 * message is capped at 10,000 characters; overflow is summarized by count
 * with a pointer to `squeal status`. Wording is factual, never imperative:
 * hooks carry no user authority and models do not follow instructions in
 * them."
 */

/** Spec 001 D6: "The message is capped at 10,000 characters". */
export const MESSAGE_CAP_CHARS = 10_000;

/** Room kept for the overflow line, its counts split (spec 005 D1), while blocks are added. */
const OVERFLOW_RESERVE = 400;
const INDENT = "      ";

/**
 * The shell command that runs the Squeal CLI, as the texts name it: `squeal`,
 * which the Claude Code plugin puts on PATH (`bin/squeal`). Spec 002 D1 as
 * amended: under Codex the hook passes the installed CLI by its path.
 */
export const SQUEAL_COMMAND = "squeal";

const statusPointer = (command: string) => `\`${command} status\` lists every known failure.`;

/** What a block counts as when it is left out: an outcome, or a retired failure. */
type Shown = KnownOutcome | "resolved";

/** `9 tests, 3 test files loaded`: the parts of `checks` (spec 005 D1). */
const partsText = (checks: readonly CheckId[], fileLevel?: string) =>
  checkPartsText(countChecks(checks), fileLevel);

/** How a file-level check is worded in a count of `shown` checks (spec 005 D1). */
const fileLevelWord = (shown: Shown) => (shown === "fail" ? "that did not load" : "loaded");

const upper = (outcome: Shown) => outcome.toUpperCase();
const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * Task 001-88: a FAIL report ends with one line naming the command that prints
 * the full output of its first failure, the name one shell word (row 011-130).
 */
function whyLine(check: CheckId, command: string): string {
  return `Full output: ${command} why ${shellWord(checkName(check))}`;
}

/**
 * Lessons, defect 22 (task 001-112): a tool boundary that may have edited
 * while no daemon validates, and none was started, says so, since any change
 * it made gets no result until a daemon validates again. Whether it changed
 * anything is unknown, so the line does not say it did (review wave 11f, S1).
 */
export function notValidatedLine(daemon: DaemonLiveness & { readonly state: "down" }): string {
  const since =
    daemon.since === null
      ? "no daemon is running"
      : `no daemon has validated since ${new Date(daemon.since).toISOString()}`;
  return `Not validated: ${since}; any change this call made has no result.`;
}

/** A check a block counts as when it is left out. */
interface Counted {
  readonly check: CheckId;
  readonly shown: Shown;
}

interface Block {
  readonly text: string;
  readonly counted: readonly Counted[];
}

function block(head: string, lines: readonly (string | null)[], counted: Counted[]): Block {
  const body = lines.filter((l): l is string => l !== null).map((l) => `${INDENT}${l}`);
  return { text: [head, ...body].join("\n"), counted };
}

/**
 * Task 001-91: a failure says who saw it, whether the changes reach it, and a
 * timeout's load; a slow failure reads as any file's (spec 004 D8 as amended
 * 2026-10-18, task 004-81).
 */
function entryBlock(entry: TransitionEntry, revision: number): Block {
  const failed = entry.to === "fail";
  return block(
    `${upper(entry.to)}  ${checkName(entry.check)}`,
    [
      failed ? seenLine(entry, revision) : change(entry),
      entry.summary === null ? null : cap(entry.summary, SUMMARY_MAX_CHARS),
      entry.location === null ? null : atText(entry.location, entry.testFileFrame),
      ...(failed ? [touchesLine(entry), loadLine(entry)] : [recoveryProvenance(entry, revision)]),
      entry.flaky === undefined ? null : capitalize(flakyText(entry.flaky)),
      entry.retry === undefined ? null : capitalize(retryText(entry.retry)),
    ],
    [{ check: entry.check, shown: entry.to }],
  );
}

/** Spec 001 D6: a retired told failure is "worded as no longer reported by the runner". */
function retiredBlock(entry: RetiredEntry): Block {
  return block(
    `RESOLVED  ${checkName(entry.check)}`,
    ["FAIL -> no longer reported by the runner"],
    [{ check: entry.check, shown: "resolved" }],
  );
}

/** A collapsed list (`collapse`) as one block that counts as `checks`, each `shown`. */
function collapsedBlock({ head, lines }: Collapsed, shown: Shown, checks: CheckId[]): Block {
  return block(
    head,
    lines,
    checks.map((check) => ({ check, shown })),
  );
}

/**
 * Failures, one block each, but one for each group that states one first
 * error and location (row 011-109, `failure-groups.ts`).
 */
function failureBlocks(
  entries: readonly TransitionEntry[],
  revision: number,
  command: string,
): Block[] {
  return failureGroups(entries, revision).map((group) => {
    const [first] = group;
    if (group.length === 1 && first !== undefined) return entryBlock(first, revision);
    const lines = groupLines(group, revision, command);
    return collapsedBlock(
      lines,
      "fail",
      group.map((e) => e.check),
    );
  });
}

/** Recoveries, one block each up to `LISTED_MAX`, else one summary (task 001-91). */
function recoveryBlocks(entries: readonly TransitionEntry[], delta: Delta): Block[] {
  const checks = entries.map((e) => e.check);
  const head = `PASS  ${plural(checks.length, "check")} recovered (FAIL -> PASS): ${partsText(checks)}`;
  const collapsed = collapse(head, checks, delta.stillFailing);
  if (collapsed !== null) return [collapsedBlock(collapsed, "pass", checks)];
  return entries.map((e) => entryBlock(e, delta.header.revision));
}

/** Retired failures, collapsed like recoveries (task 001-91). */
function retiredBlocks(entries: readonly RetiredEntry[], delta: Delta): Block[] {
  const checks = entries.map((e) => e.check);
  const head = `RESOLVED  ${plural(checks.length, "check")} no longer reported by the runner (FAIL -> RESOLVED): ${partsText(checks)}`;
  const collapsed = collapse(head, checks, delta.stillFailing);
  if (collapsed !== null) return [collapsedBlock(collapsed, "resolved", checks)];
  return entries.map(retiredBlock);
}

/**
 * Spec 001 D12: a crashed tier yields "one factual line", so unknowns group
 * by reason. The reason is cut at `SUMMARY_MAX_CHARS`, so the block names
 * where it is whole, as a FAIL names its output (task 011-02).
 */
function unknownBlocks(entries: readonly TransitionEntry[], command: string): Block[] {
  const byReason = new Map<string, TransitionEntry[]>();
  for (const e of entries) {
    const reason = e.summary ?? "no trusted result";
    byReason.set(reason, [...(byReason.get(reason) ?? []), e]);
  }
  return [...byReason].map(([reason, group]) => {
    const files = [...new Set(group.map((e) => e.check.testPath))];
    const first = group[0]?.check;
    const from = (outcome: KnownOutcome) =>
      group.filter((e) => e.from === outcome).map((e) => e.check);
    const counts = (["pass", "fail"] as const)
      .filter((o) => from(o).length > 0)
      .map((o) => `${upper(o)} -> UNKNOWN (${partsText(from(o))})`);
    const listed = files.slice(0, 5).join(", ");
    const more = files.length > 5 ? ` and ${plural(files.length - 5, "more file")}` : "";
    return block(
      `UNKNOWN  ${checksText(group.map((e) => e.check))} in ${plural(files.length, "test file")}`,
      [
        counts.join(", "),
        cap(reason, SUMMARY_MAX_CHARS),
        `${listed}${more}`,
        first === undefined ? null : `Full reason: ${command} why ${shellWord(checkName(first))}`,
      ],
      group.map((e) => ({ check: e.check, shown: "unknown" })),
    );
  });
}

/**
 * Adds blocks in order while they fit in `max` with `tail` after them; the
 * rest is summarized by `overflow`.
 */
function assemble(
  head: string,
  blocks: readonly Block[],
  overflow: (left: Block[]) => string,
  tail: string | null,
  max: number,
): string {
  const end = tail === null ? "" : `\n\n${tail}`;
  const room = max - end.length;
  let out = head;
  for (const [i, b] of blocks.entries()) {
    const next = `${out}\n\n${b.text}`;
    const last = i === blocks.length - 1;
    if (next.length <= room - (last ? 0 : OVERFLOW_RESERVE)) {
      out = next;
      continue;
    }
    return `${cap(`${out}\n\n${overflow(blocks.slice(i))}`, room)}${end}`;
  }
  return `${out}${end}`;
}

/**
 * Renders a delta: header, failures first, unknowns, recoveries, retired
 * failures. `command` is how the text names the CLI (`SQUEAL_COMMAND`);
 * `max` below the cap leaves room for a line the hook adds (task 001-292).
 * A change delivery sends the news form of the header; Stop the full block
 * (task 001-407).
 */
export function formatDelta(
  delta: Delta,
  command: string = SQUEAL_COMMAND,
  max: number = MESSAGE_CAP_CHARS,
  form: HeaderForm = "news",
): string {
  const { header, entries } = delta;
  const changed = entries.filter((e): e is TransitionEntry => e.kind !== "fail-retired");
  const retired = entries.filter((e): e is RetiredEntry => e.kind === "fail-retired");
  // Row 011-73 (C8 as amended 2026-10-21): each start or end of a hold is a line; the first may be the title.
  const holds = (delta.holds ?? []).map((c) => holdChangeLine(c, header.revision, command));
  const holdTitle = entries.length === 0 && delta.liveness === undefined ? holds[0] : undefined;
  const title =
    entries.length === 0
      ? delta.liveness === undefined
        ? (holdTitle ?? `SQUEAL · revision ${header.revision}`)
        : livenessTitle(delta.liveness, header.revision)
      : delta.label === "baseline"
        ? `SQUEAL · Squeal's baseline run found ${checksText(checksOf(entries), "failing check", "that did not load")} at revision ${header.revision}`
        : `SQUEAL · ${plural(entries.length, "check")} changed (${partsText(checksOf(entries))}) at revision ${header.revision}`;
  const blocks = [
    ...failureBlocks(
      changed.filter((e) => e.to === "fail"),
      header.revision,
      command,
    ),
    ...unknownBlocks(
      changed.filter((e) => e.to === "unknown"),
      command,
    ),
    ...recoveryBlocks(
      changed.filter((e) => e.to === "pass"),
      delta,
    ),
    ...retiredBlocks(retired, delta),
  ];
  const failed = changed.find((e) => e.to === "fail");
  const overflow = (left: Block[]) => {
    const counted = left.flatMap((b) => b.counted);
    const by = (["fail", "pass", "unknown", "resolved"] as const)
      .map((o) => [o, counted.filter((c) => c.shown === o).map((c) => c.check)] as const)
      .filter(([, checks]) => checks.length > 0)
      .map(([o, checks]) => `${checks.length} ${upper(o)}: ${partsText(checks, fileLevelWord(o))}`);
    return `Not shown: ${counted.length} more changed checks (${by.join("; ")}). ${statusPointer(command)}`;
  };
  const tail = failed === undefined ? null : whyLine(failed.check, command);
  return assemble(
    [
      title,
      ...headerLines(header, command, form, delta.slowTierChanged === true),
      ...(holdTitle === undefined ? holds : holds.slice(1)),
      ...editLines(delta),
    ].join("\n"),
    blocks,
    overflow,
    tail,
    max,
  );
}

/** Task 001-224, decided by the human: said once per consumer, after its first edit. */
export function sawEditLine(queued: number): string {
  return (
    `Squeal saw your edit and queued ${plural(queued, "test file")}; ` +
    "results arrive with later tool calls, and passing ones stay silent."
  );
}

/** Task 001-223: once none of the test files the consumer's edits re-keyed is pending. */
export function settledLine({ since, files, unknown }: EditsSettled): string {
  const which = `${files === 1 ? "The test file" : `All ${files} test files`} your edits since revision ${since} re-keyed`;
  if (unknown === 0) return `${which} ${files === 1 ? "is" : "are"} current.`;
  return `${which} finished: ${files - unknown} current, ${unknown} with no result (unknown).`;
}

/**
 * Tasks 001-223 and 001-224 in one delivery: the edit's files are already
 * settled, so "results arrive with later tool calls" would contradict them.
 */
export function sawSettledLine({ files, unknown }: EditsSettled): string {
  const head = "Squeal saw your edit; ";
  const tail = "passing results stay silent.";
  if (unknown === 0) {
    const which = files === 1 ? "the 1 test file" : `all ${files} test files`;
    return `${head}${which} it re-keyed ${files === 1 ? "is" : "are"} current, and ${tail}`;
  }
  return (
    `${head}of the ${plural(files, "test file")} it re-keyed, ${files - unknown} current and ` +
    `${unknown} with no result (unknown); ${tail}`
  );
}

/** The lines on the consumer's own edits, after the header (tasks 001-223, 001-224). */
function editLines({ sawEdit, editsSettled }: Delta): string[] {
  if (sawEdit !== undefined && editsSettled !== undefined) return [sawSettledLine(editsSettled)];
  return [
    ...(sawEdit === undefined ? [] : [sawEditLine(sawEdit.queued)]),
    ...(editsSettled === undefined ? [] : [settledLine(editsSettled)]),
  ];
}

const checksOf = (entries: readonly DeltaEntry[]) => entries.map((e) => e.check);

/** A hold's start or end (row 011-73), as a delivery says it. */
function holdChangeLine(change: HoldChange, revision: number, command: string): string {
  switch (change.kind) {
    case "on-hold":
      return `SQUEAL · validation on hold at revision ${revision}: ${holdStartText(change.hold, command)}`;
    case "ended":
      return `SQUEAL · a hold ended at revision ${revision}: ${holdEndedText(change)}`;
    case "resumed":
      return `SQUEAL · validating again at revision ${revision}: ${holdEndText(change)}`;
  }
}

/** The title of a delta that carries only a change of daemon liveness. */
function livenessTitle(liveness: DaemonLiveness | undefined, revision: number): string {
  // Row 011-34: the header after it says since when, and what follows.
  if (liveness?.stopping !== undefined) {
    const what = liveness.stopping.to === undefined ? "stopping" : "handing over";
    return `SQUEAL · the daemon is ${what} at revision ${revision}`;
  }
  // Task 011-08: the header after it says what restarts it.
  if (liveness?.state === "down" && liveness.stopped === true) {
    return `SQUEAL · the daemon is stopped by request at revision ${revision}`;
  }
  // Row 011-140: the header after it names the claim's version and `squeal start`.
  if (liveness?.state === "alive" && liveness.short !== undefined) {
    return `SQUEAL · a ${liveness.short.version} daemon is validating at revision ${revision}, not ${liveness.short.claimed}`;
  }
  return liveness?.state === "alive"
    ? `SQUEAL · a daemon is validating again at revision ${revision}`
    : `SQUEAL · no daemon is validating at revision ${revision}`;
}

/**
 * Renders a registration: header and every known failure, which are never
 * delivered again. `max` below the cap leaves room for text the hook adds;
 * `command` is how the text names the CLI (`SQUEAL_COMMAND`); `now` dates
 * each failure's recorded run (001-404).
 */
export function formatRegistration(
  registration: Registration,
  max: number = MESSAGE_CAP_CHARS,
  command: string = SQUEAL_COMMAND,
  now: number = Date.now(),
): string {
  const { header, knownFailures } = registration;
  const head = [
    `SQUEAL · registered at revision ${header.revision}`,
    ...headerLines(header, command),
    // Spec 001 D4 (task 001-176): said once, at registration; status lists it among the notes.
    ...(header.optimizerOff === undefined ? [] : [header.optimizerOff]),
    // Spec 011 C6 as amended (gh-34, gh-45): status's count and words.
    `Known failures: ${failureCountText(splitByValidity(knownFailures).current.map((f) => f.check))}${notCurrentText(header)}`,
    ...earlierFailuresLines(knownFailureCounts(knownFailures)),
  ].join("\n");
  const blocks = knownFailures.map((f: KnownFailure) =>
    block(
      `FAIL  ${checkName(f.check)}`,
      [
        f.summary === "" ? null : cap(f.summary, SUMMARY_MAX_CHARS),
        f.location === null ? null : atText(f.location, f.testFileFrame),
        f.validity === "current" ? null : `${f.validity}, observed at revision ${f.observedAt}`,
        f.recorded === undefined
          ? f.recordedUnknown === true
            ? capitalize(RECORDED_UNKNOWN_TEXT)
            : null
          : // Row 011-67 (gh-52): a failure recorded under load names its load retry.
            capitalize(
              recordedText(f.recorded, registration.consumer.worktreeId, now, {
                command,
                path: f.check.testPath,
              }),
            ),
        closureLine(f.changesInClosure),
      ],
      [{ check: f.check, shown: "fail" }],
    ),
  );
  const first = knownFailures[0];
  const notShown = (left: Block[]) =>
    checksText(
      left.flatMap((b) => b.counted.map((c) => c.check)),
      "more known failure",
      "that did not load",
    );
  return assemble(
    head,
    blocks,
    (left) => `Not shown: ${notShown(left)}. ${statusPointer(command)}`,
    first === undefined ? null : whyLine(first.check, command),
    max,
  );
}
