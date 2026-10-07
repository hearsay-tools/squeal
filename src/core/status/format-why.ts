import { formatCheck } from "../state/index.js";
import { plural } from "../text.js";
import type {
  KnownOutcome,
  KnownState,
  Transition,
  WhyReport,
  WhyResult,
  WhyResultEntry,
} from "../types/index.js";
import { formatUnavailable, shortCommit } from "./format-status.js";

const INDENT = "        ";

/** Human rendering of `squeal why <check>`. Full stacks included: the reader asked for them. */
export function formatWhy(why: WhyResult): string {
  if (!why.available) return formatUnavailable(why);
  if (!why.found) {
    if (why.candidates.length === 0) return `No check matches "${why.query}" in this worktree.\n`;
    return `${[
      `"${why.query}" matches ${why.candidates.length} checks in this worktree:`,
      ...why.candidates.map((c) => `  ${formatCheck(c)}`),
    ].join("\n")}\n`;
  }
  const lines = [
    `Check: ${formatCheck(why.check)}`,
    `Worktree: ${why.worktreeRoot}`,
    `Revision: ${why.revision ?? "none recorded"}`,
    "",
    ...knownState(why, why.knownState),
    "",
    ...history(why.history),
    "",
    ...results(why),
    "",
    `Last run log: ${why.results[0]?.logDir ?? "none"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function knownState(why: WhyReport, s: KnownState | null): string[] {
  if (s === null) return ["Known state: none in this worktree"];
  const head = [
    upper(s.outcome),
    s.pendingPhase === null ? s.validity : `${s.validity} (${s.pendingPhase})`,
    ...(s.observedAt === null ? [] : [`observed at revision ${s.observedAt}`]),
    ...(s.commit === null ? [] : [`commit ${shortCommit(s.commit)}`]),
  ];
  const lines = [`Known state: ${head.join(", ")}`];
  if (s.origin?.kind === "inherited") {
    const source =
      why.worktreeRoots[s.origin.worktreeId] ?? `removed worktree ${s.origin.worktreeId}`;
    lines.push(`  Origin: inherited from ${source} at ${shortCommit(s.origin.commit)}`);
  }
  if (s.summary !== null) lines.push(`  Summary: ${s.summary}`);
  if (s.location !== null) {
    lines.push(`  Location: ${s.location.path}:${s.location.line}:${s.location.column}`);
  }
  if (s.fingerprint !== null) lines.push(`  Fingerprint: ${s.fingerprint}`);
  return lines;
}

function history(transitions: readonly Transition[]): string[] {
  if (transitions.length === 0) return ["History: no transitions in this worktree"];
  return [
    `History (${plural(transitions.length, "transition")}, oldest first):`,
    ...transitions.map(
      (t) => `  revision ${t.revision}  ${new Date(t.at).toISOString()}  ${transitionText(t)}`,
    ),
  ];
}

/** Styleguide: "Transitions are written `PASS -> FAIL`, uppercase". */
function transitionText(t: Transition): string {
  if (t.kind === "first-seen-fail") return "first seen FAIL";
  const change = `${t.from === null ? "NONE" : upper(t.from)} -> ${upper(t.to)}`;
  return t.kind === "fail-changed" ? `${change}, failure changed` : change;
}

function results(why: WhyReport): string[] {
  if (why.results.length === 0) return ["Results: none stored"];
  return [
    `Results (${why.results.length}, newest first):`,
    ...why.results.flatMap((entry) => resultLines(why, entry)),
  ];
}

function resultLines(why: WhyReport, { result, worktreeRoot, logDir }: WhyResultEntry): string[] {
  const p = result.provenance;
  const where =
    p.worktreeId === why.worktreeId
      ? `${worktreeRoot ?? why.worktreeRoot} (this worktree)`
      : (worktreeRoot ?? `removed worktree ${p.worktreeId}`);
  const lines = [
    `  ${upper(result.outcome).padEnd(4)}  ${new Date(p.recordedAt).toISOString()}  ${where}, revision ${p.revision}, commit ${shortCommit(p.commit)}, ${p.dirty ? "dirty" : "clean"}`,
    `${INDENT}run ${p.runId}, ${Math.round(result.durationMs)} ms, key ${result.key.slice(0, 12)}`,
    `${INDENT}log: ${logDir ?? "run record pruned"}`,
  ];
  if (result.summary !== null) lines.push(`${INDENT}${result.summary}`);
  for (const error of result.errors) {
    const text = [error.stack ?? `${error.name}: ${error.message}`, error.diff]
      .filter((part) => part !== null)
      .join("\n");
    for (const line of text.split("\n")) lines.push(`${INDENT}${line}`);
  }
  return lines;
}

function upper(outcome: KnownOutcome): string {
  return outcome.toUpperCase();
}
