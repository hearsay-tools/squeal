import { formatCheck, SUMMARY_MAX_CHARS } from "../state/index.js";
import type {
  CheckId,
  Delta,
  KnownFailure,
  KnownOutcome,
  Registration,
  RetiredEntry,
  SourceLocation,
  StatusHeader,
  TransitionEntry,
} from "../types/index.js";

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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/** `squeal why` resolves a capped name by the part before `...`. */
function checkName(check: CheckId): string {
  return cap(formatCheck(check), SUMMARY_MAX_CHARS);
}

function at(location: SourceLocation): string {
  return `at ${location.path}:${location.line}:${location.column}`;
}

function headerLine(header: StatusHeader): string {
  const { revision, counts, testFilesWithoutChecks: files, fullSuite } = header;
  const suite = fullSuite.atCurrentRevision
    ? `completed at revision ${revision}`
    : fullSuite.lastCompletedRevision === null
      ? "not completed at any revision"
      : `not completed at revision ${revision}, last completed at revision ${fullSuite.lastCompletedRevision}`;
  const withoutChecks =
    files.pending + files.unknown === 0
      ? ""
      : ` Test files without checks: ${files.pending} pending, ${files.unknown} unknown.`;
  return (
    `Revision ${revision}: ${counts.current} current, ${counts.pending} pending, ` +
    `${counts.stale} stale, ${counts.unknown} unknown.${withoutChecks} Full suite: ${suite}.`
  );
}

function change(entry: TransitionEntry): string {
  switch (entry.kind) {
    case "first-seen-fail": {
      const line = entry.from === null ? "first observed: FAIL" : `${upper(entry.from)} -> FAIL`;
      return entry.baseline === true ? `baseline finding, ${line}` : line;
    }
    case "fail-changed":
      return "FAIL -> FAIL, failure changed";
    default:
      return `${entry.from === null ? "NONE" : upper(entry.from)} -> ${upper(entry.to)}`;
  }
}

function provenance(entry: TransitionEntry, revision: number): string | null {
  const parts: string[] = [];
  if (entry.validity === "stale") parts.push(`stale, observed at revision ${entry.observedAt}`);
  if (entry.validity === "pending") {
    parts.push(`observed at revision ${entry.observedAt}, revision ${revision} pending`);
  }
  if (entry.origin.kind === "inherited") {
    const commit =
      entry.origin.commit === null ? "no commit" : `commit ${entry.origin.commit.slice(0, 12)}`;
    parts.push(`inherited from worktree ${entry.origin.worktreeId} at ${commit}`);
  }
  return parts.length === 0 ? null : parts.join("; ");
}

interface Block {
  readonly text: string;
  readonly outcomes: readonly Shown[];
}

function block(head: string, lines: readonly (string | null)[], outcomes: Shown[]): Block {
  const body = lines.filter((l): l is string => l !== null).map((l) => `${INDENT}${l}`);
  return { text: [head, ...body].join("\n"), outcomes };
}

function entryBlock(entry: TransitionEntry, revision: number): Block {
  return block(
    `${upper(entry.to)}  ${checkName(entry.check)}`,
    [
      change(entry),
      entry.summary === null ? null : cap(entry.summary, SUMMARY_MAX_CHARS),
      entry.location === null ? null : at(entry.location),
      provenance(entry, revision),
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

/** Adds blocks in order while they fit; the rest is summarized by `overflow`. */
function assemble(
  head: string,
  blocks: readonly Block[],
  overflow: (left: Block[]) => string,
): string {
  let out = head;
  for (const [i, b] of blocks.entries()) {
    const next = `${out}\n\n${b.text}`;
    const last = i === blocks.length - 1;
    if (next.length <= MESSAGE_CAP_CHARS - (last ? 0 : OVERFLOW_RESERVE)) {
      out = next;
      continue;
    }
    return cap(`${out}\n\n${overflow(blocks.slice(i))}`, MESSAGE_CAP_CHARS);
  }
  return out;
}

/** Renders a delta: header, failures first, unknowns, recoveries, retired failures. */
export function formatDelta(delta: Delta): string {
  const { header, entries } = delta;
  const changed = entries.filter((e): e is TransitionEntry => e.kind !== "fail-retired");
  const retired = entries.filter((e): e is RetiredEntry => e.kind === "fail-retired");
  const title =
    delta.label === "baseline"
      ? `SQUEAL · baseline: ${plural(entries.length, "failing check")} found at revision ${header.revision}`
      : `SQUEAL · ${plural(entries.length, "check")} changed at revision ${header.revision}`;
  const blocks = [
    ...changed.filter((e) => e.to === "fail").map((e) => entryBlock(e, header.revision)),
    ...unknownBlocks(changed.filter((e) => e.to === "unknown")),
    ...changed.filter((e) => e.to === "pass").map((e) => entryBlock(e, header.revision)),
    ...retired.map(retiredBlock),
  ];
  return assemble(`${title}\n${headerLine(header)}`, blocks, (left) => {
    const outcomes = left.flatMap((b) => b.outcomes);
    const by = (["fail", "pass", "unknown", "resolved"] as const)
      .map((o) => [o, outcomes.filter((x) => x === o).length] as const)
      .filter(([, n]) => n > 0)
      .map(([o, n]) => `${n} ${upper(o)}`);
    return `Not shown: ${outcomes.length} more changed checks (${by.join(", ")}). ${STATUS_POINTER}`;
  });
}

/** Renders a registration: header and every known failure, which are never delivered again. */
export function formatRegistration(registration: Registration): string {
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
  return assemble(
    head,
    blocks,
    (left) => `Not shown: ${left.length} more known failures. ${STATUS_POINTER}`,
  );
}
