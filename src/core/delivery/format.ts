import { fullSuiteText, runnerPartText, SUMMARY_MAX_CHARS } from "../state/index.js";
import { cap, plural } from "../text.js";
import type {
  CheckId,
  DaemonLiveness,
  Delta,
  KnownFailure,
  KnownOutcome,
  Registration,
  RetiredEntry,
  SourceLocation,
  StatusHeader,
  TransitionEntry,
} from "../types/index.js";
import { type Collapsed, checkName, collapse } from "./collapse.js";
import {
  change,
  installSentences,
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

/** Room kept for the overflow line while blocks are added. */
const OVERFLOW_RESERVE = 200;
const INDENT = "      ";
const STATUS_POINTER = "`squeal status` lists every known failure.";

/** What a block counts as when it is left out: an outcome, or a retired failure. */
type Shown = KnownOutcome | "resolved";

const upper = (outcome: Shown) => outcome.toUpperCase();
const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * Task 001-88: a FAIL report ends with one line naming the command that prints
 * the full output of its first failure. A name the shell would expand inside
 * double quotes is single-quoted.
 */
function whyLine(check: CheckId): string {
  const name = checkName(check);
  const quoted = /["$`\\]/.test(name) ? `'${name.replaceAll("'", "'\\''")}'` : `"${name}"`;
  return `Full output: squeal why ${quoted}`;
}

function at(location: SourceLocation): string {
  return `at ${location.path}:${location.line}:${location.column}`;
}

/** Spec 001 D7 as amended: the daemon has not listed the test files, so zero counts are not complete. */
const NOT_LISTED_SENTENCE =
  "The daemon has not listed this worktree's test files yet; these counts are not complete.";

/** Spec 001 D5 as amended (task 001-100): the daemon waits for an install. */
const AWAITING_INSTALL_SENTENCE =
  "No dependencies are installed in this worktree; Squeal lists and runs no tests until an install.";

/** Paths a header names before the rest is counted (task 001-85). */
export const CHANGED_PATHS_SHOWN = 3;

/** `(changed a, b, c and N more)` after the revision number; nothing without a change set. */
function changedText(paths: readonly string[] | undefined): string {
  if (paths === undefined || paths.length === 0) return "";
  const shown = paths.slice(0, CHANGED_PATHS_SHOWN).join(", ");
  const more = paths.length - CHANGED_PATHS_SHOWN;
  return ` (changed ${shown}${more > 0 ? ` and ${more} more` : ""})`;
}

function headerLine(header: StatusHeader): string {
  const { revision, counts, testFilesWithoutChecks: files } = header;
  const inherited =
    (header.inheritedCount ?? 0) === 0
      ? ""
      : ` Inherited: ${header.inheritedCount} of ${counts.current} current.`;
  const withoutChecks =
    files.pending + files.unknown === 0
      ? ""
      : ` Test files without checks: ${files.pending} pending, ${files.unknown} unknown.`;
  const listed = header.testFilesListed === false ? ` ${NOT_LISTED_SENTENCE}` : "";
  const runnerPart =
    header.runnerPartPending === true
      ? ` ${capitalize(runnerPartText(revision))} is pending; test files it adds are not counted yet.`
      : "";
  return (
    `Revision ${revision}${changedText(header.changedPaths)}: ${counts.current} current, ${counts.pending} pending, ` +
    `${counts.stale} stale, ${counts.unknown} unknown.${inherited}${withoutChecks}${listed}${runnerPart} ` +
    `Full-suite checkpoint: ${fullSuiteText(header)}.` +
    livenessSentence(header.daemon, revision) +
    (header.awaitingInstall === true ? ` ${AWAITING_INSTALL_SENTENCE}` : installSentences(header))
  );
}

/**
 * Spec 001 D12, review wave 3 S2: "Dead daemon: hooks still serve status and
 * deltas from the store; status says the daemon is down and since when." A
 * validating daemon adds nothing.
 */
function livenessSentence(daemon: DaemonLiveness | undefined, revision: number): string {
  if (daemon === undefined || daemon.state === "alive") return "";
  const since =
    daemon.since === null
      ? "No daemon is running"
      : `No daemon has validated since ${new Date(daemon.since).toISOString()}`;
  return ` ${since}; results are as of revision ${revision}.`;
}

interface Block {
  readonly text: string;
  readonly outcomes: readonly Shown[];
}

function block(head: string, lines: readonly (string | null)[], outcomes: Shown[]): Block {
  const body = lines.filter((l): l is string => l !== null).map((l) => `${INDENT}${l}`);
  return { text: [head, ...body].join("\n"), outcomes };
}

/** Task 001-91: a failure says who saw it, whether the changes reach it, and a timeout's load. */
function entryBlock(entry: TransitionEntry, revision: number): Block {
  const failed = entry.to === "fail";
  return block(
    `${upper(entry.to)}  ${checkName(entry.check)}`,
    [
      failed ? seenLine(entry, revision) : change(entry),
      entry.summary === null ? null : cap(entry.summary, SUMMARY_MAX_CHARS),
      entry.location === null ? null : at(entry.location),
      ...(failed ? [touchesLine(entry), loadLine(entry)] : [recoveryProvenance(entry, revision)]),
    ],
    [entry.to],
  );
}

/** Spec 001 D6: a retired told failure is "worded as no longer reported by the runner". */
function retiredBlock(entry: RetiredEntry): Block {
  return block(
    `RESOLVED  ${checkName(entry.check)}`,
    ["FAIL -> no longer reported by the runner"],
    ["resolved"],
  );
}

/** A collapsed list (`collapse`) as one block that counts as `count` of `outcome`. */
function collapsedBlock({ head, lines }: Collapsed, outcome: Shown, count: number): Block {
  return block(
    head,
    lines,
    Array.from({ length: count }, () => outcome),
  );
}

/** Recoveries, one block each up to `LISTED_MAX`, else one summary (task 001-91). */
function recoveryBlocks(entries: readonly TransitionEntry[], delta: Delta): Block[] {
  const head = `PASS  ${plural(entries.length, "check")} recovered (FAIL -> PASS)`;
  const collapsed = collapse(
    head,
    entries.map((e) => e.check),
    delta.stillFailing,
  );
  if (collapsed !== null) return [collapsedBlock(collapsed, "pass", entries.length)];
  return entries.map((e) => entryBlock(e, delta.header.revision));
}

/** Retired failures, collapsed like recoveries (task 001-91). */
function retiredBlocks(entries: readonly RetiredEntry[], delta: Delta): Block[] {
  const head = `RESOLVED  ${plural(entries.length, "check")} no longer reported by the runner (FAIL -> RESOLVED)`;
  const collapsed = collapse(
    head,
    entries.map((e) => e.check),
    delta.stillFailing,
  );
  if (collapsed !== null) return [collapsedBlock(collapsed, "resolved", entries.length)];
  return entries.map(retiredBlock);
}

/** Spec 001 D12: a crashed tier yields "one factual line", so unknowns group by reason. */
function unknownBlocks(entries: readonly TransitionEntry[]): Block[] {
  const byReason = new Map<string, TransitionEntry[]>();
  for (const e of entries) {
    const reason = e.summary ?? "no trusted result";
    byReason.set(reason, [...(byReason.get(reason) ?? []), e]);
  }
  return [...byReason].map(([reason, group]) => {
    const files = [...new Set(group.map((e) => e.check.testPath))];
    const from = (outcome: KnownOutcome) => group.filter((e) => e.from === outcome).length;
    const counts = (["pass", "fail"] as const)
      .filter((o) => from(o) > 0)
      .map((o) => `${upper(o)} -> UNKNOWN (${from(o)})`);
    const listed = files.slice(0, 5).join(", ");
    const more = files.length > 5 ? ` and ${plural(files.length - 5, "more file")}` : "";
    return block(
      `UNKNOWN  ${plural(group.length, "check")} in ${plural(files.length, "test file")}`,
      [counts.join(", "), cap(reason, SUMMARY_MAX_CHARS), `${listed}${more}`],
      group.map(() => "unknown"),
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

/** Renders a delta: header, failures first, unknowns, recoveries, retired failures. */
export function formatDelta(delta: Delta): string {
  const { header, entries } = delta;
  const changed = entries.filter((e): e is TransitionEntry => e.kind !== "fail-retired");
  const retired = entries.filter((e): e is RetiredEntry => e.kind === "fail-retired");
  const title =
    entries.length === 0
      ? livenessTitle(delta.liveness, header.revision)
      : delta.label === "baseline"
        ? `SQUEAL · Squeal's run at start (baseline) found ${plural(entries.length, "failing check")} at revision ${header.revision}`
        : `SQUEAL · ${plural(entries.length, "check")} changed at revision ${header.revision}`;
  const blocks = [
    ...changed.filter((e) => e.to === "fail").map((e) => entryBlock(e, header.revision)),
    ...unknownBlocks(changed.filter((e) => e.to === "unknown")),
    ...recoveryBlocks(
      changed.filter((e) => e.to === "pass"),
      delta,
    ),
    ...retiredBlocks(retired, delta),
  ];
  const failed = changed.find((e) => e.to === "fail");
  const overflow = (left: Block[]) => {
    const outcomes = left.flatMap((b) => b.outcomes);
    const by = (["fail", "pass", "unknown", "resolved"] as const)
      .map((o) => [o, outcomes.filter((x) => x === o).length] as const)
      .filter(([, n]) => n > 0)
      .map(([o, n]) => `${n} ${upper(o)}`);
    return `Not shown: ${outcomes.length} more changed checks (${by.join(", ")}). ${STATUS_POINTER}`;
  };
  const tail = failed === undefined ? null : whyLine(failed.check);
  return assemble(`${title}\n${headerLine(header)}`, blocks, overflow, tail, MESSAGE_CAP_CHARS);
}

/** The title of a delta that carries only a change of daemon liveness. */
function livenessTitle(liveness: DaemonLiveness | undefined, revision: number): string {
  return liveness?.state === "alive"
    ? `SQUEAL · a daemon is validating again at revision ${revision}`
    : `SQUEAL · no daemon is validating at revision ${revision}`;
}

/**
 * Renders a registration: header and every known failure, which are never
 * delivered again. `max` below the cap leaves room for text the hook adds.
 */
export function formatRegistration(
  registration: Registration,
  max: number = MESSAGE_CAP_CHARS,
): string {
  const { header, knownFailures } = registration;
  const head = [
    `SQUEAL · registered at revision ${header.revision}`,
    headerLine(header),
    `Known failures: ${knownFailures.length}`,
  ].join("\n");
  const blocks = knownFailures.map((f: KnownFailure) =>
    block(
      `FAIL  ${checkName(f.check)}`,
      [
        f.summary === "" ? null : cap(f.summary, SUMMARY_MAX_CHARS),
        f.location === null ? null : at(f.location),
        f.validity === "current" ? null : `${f.validity}, observed at revision ${f.observedAt}`,
      ],
      ["fail"],
    ),
  );
  const first = knownFailures[0];
  return assemble(
    head,
    blocks,
    (left) => `Not shown: ${left.length} more known failures. ${STATUS_POINTER}`,
    first === undefined ? null : whyLine(first.check),
    max,
  );
}
