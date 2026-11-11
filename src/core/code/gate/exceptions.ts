import { compare } from "../../fs/compare.js";
import { isRecord } from "../../fs/json.js";
import type { FunctionCount } from "../../types/code.js";
import type { RelativePath } from "../../types/common.js";
import type { BasePolicy } from "./policy.js";
import type {
  GateExceptionOutcome,
  GateExceptionUse,
  GateFunctionReport,
  GateUnusedException,
} from "./report.js";
import { type CountedPath, EXCEPTIONS_FORMAT, type ExceptionEntry, type GateGap } from "./types.js";

/*
 * Spec 020 D8 (row 020-09): exceptions. The consumer verified the entries;
 * Squeal applies them to the judged functions and keeps the measured
 * scores. An entry applies only to a changed function with its path, name
 * and body hash, at the merge base it names. Pure: no I/O.
 */

/** A function judged under D5, before the exceptions. */
export interface Judged {
  readonly row: GateFunctionReport;
  /**
   * D5 without the CC rule: what the coverage evidence alone says. A pass,
   * a violation by CRAP, an incomplete state with its gap, or `skipped` for
   * a file that wants no coverage.
   */
  readonly evidence: Pick<GateFunctionReport, "state" | "gap">;
  /**
   * D5's completeness: the gap of the first condition of complete evidence
   * that does not hold, `null` when all do or the file wants no coverage.
   * A pass by 015 D9's bound, from a subset of the loaders or beside a
   * skipped test (D11.3), has one, so no exception accepts it (review
   * 0.1.424 B1). The rule (`judgeFunction`) gives it.
   */
  readonly gap: GateGap | null;
}

/**
 * What `applyExceptions` reads besides the functions. The CRAP limit is in
 * each function's evidence already: a CRAP over it reads a violation there.
 */
export interface ExceptionRules {
  readonly policy: Pick<BasePolicy, "complexityThreshold">;
  readonly baseCommit: string;
}

type Judgement = Pick<GateFunctionReport, "state" | "gap">;
const VIOLATION: Judgement = { state: "violation", gap: null };
const ACCEPTED: Judgement = { state: "accepted", gap: null };

/** The order of entries in the report: by function, then measure and kind. */
function byEntry(a: ExceptionEntry, b: ExceptionEntry): number {
  return (
    compare(a.path, b.path) ||
    compare(a.qualifiedName, b.qualifiedName) ||
    compare(a.measure, b.measure) ||
    compare(a.kind, b.kind) ||
    compare(a.bodyHash, b.bodyHash) ||
    a.value - b.value
  );
}

/** The head's value of `entry`'s measure; a CRAP not measured reads as over any value. */
const headValue = (entry: ExceptionEntry, row: GateFunctionReport) =>
  entry.measure === "complexity" ? row.complexity : (row.crap ?? Number.POSITIVE_INFINITY);

/** D8: what an inherited entry's rule says, from the CC at the base. */
function inherited(
  entry: ExceptionEntry,
  row: GateFunctionReport,
  base: FunctionCount | null,
  ccLimit: number,
): GateExceptionOutcome {
  if (base === null) return "not-at-base";
  if (entry.measure === "complexity" && base.complexity <= ccLimit) return "not-over-at-base";
  if (row.complexity > base.complexity) return "worse-than-base";
  const at = entry.measure === "complexity" ? base.complexity : headValue(entry, row);
  return at > entry.value ? "over-value" : "covers";
}

/**
 * D8: one entry's rule for its function. CC needs only the count; CRAP
 * needs complete evidence, and is over its limit only when the evidence
 * alone reads a violation.
 */
function outcomeOf(
  entry: ExceptionEntry,
  { row, evidence }: Judged,
  base: FunctionCount | null,
  rules: ExceptionRules,
): GateExceptionOutcome {
  const ccLimit = rules.policy.complexityThreshold;
  if (entry.measure === "complexity") {
    if (row.complexity <= ccLimit) return "not-needed";
  } else {
    if (evidence.state === "incomplete") return "incomplete";
    if (evidence.state !== "violation") return "not-needed";
  }
  if (entry.kind === "inherited") return inherited(entry, row, base, ccLimit);
  return headValue(entry, row) > entry.value ? "over-value" : "covers";
}

/**
 * D8: the state once the entries are read. CC over the limit with no entry
 * that covers it stays a violation on the count alone; an incomplete one
 * stays incomplete; a CRAP over the limit needs its own entry. A covered
 * violation reads `accepted` only on complete evidence (D5); a subset's
 * pass reads its gap instead.
 */
function stateOf(judged: Judged, uses: readonly GateExceptionUse[], cc: number): Judgement {
  const { row, evidence, gap } = judged;
  // D14.2: a left-out loader makes a CRAP violation incomplete, and leaves D8 the violation to cover.
  if (row.state === "incomplete" && evidence.state === "incomplete") return row;
  const covers = (measure: ExceptionEntry["measure"]) =>
    uses.some((u) => u.entry.measure === measure && u.outcome === "covers");
  const ccOver = row.complexity > cc;
  if (ccOver && !covers("complexity")) return VIOLATION;
  if (evidence.state === "incomplete") return evidence;
  const accepted: Judgement = gap === null ? ACCEPTED : { state: "incomplete", gap };
  if (evidence.state === "violation") {
    return covers("crap") ? accepted : { state: row.state, gap: row.gap };
  }
  return ccOver ? accepted : evidence;
}

/** The base function of an `edited` row: its identity at the base; `null` otherwise. */
function baseOf(
  row: GateFunctionReport,
  bases: ReadonlyMap<RelativePath, readonly FunctionCount[]>,
): FunctionCount | null {
  if (row.change !== "edited") return null;
  const at = bases
    .get(row.path)
    ?.find((f) => f.qualifiedName === row.qualifiedName && f.occurrence === row.occurrence);
  return at ?? null;
}

/** Why `entry` names no function of `rows` at `baseCommit`. */
function unusedWhy(
  entry: ExceptionEntry,
  rows: readonly GateFunctionReport[],
  baseCommit: string,
): GateUnusedException["why"] {
  if (entry.baseCommit !== baseCommit) return "base-commit";
  const named = rows.some((r) => r.path === entry.path && r.qualifiedName === entry.qualifiedName);
  return named ? "body-hash" : "no-function";
}

const names = (entry: ExceptionEntry, row: GateFunctionReport) =>
  entry.path === row.path &&
  entry.qualifiedName === row.qualifiedName &&
  entry.bodyHash === row.bodyHash;

/**
 * Spec 020 D8: each judged function with the entries that name it, and the
 * entries that name none. A covered violation reads `accepted` with its
 * measured scores; a function with no entry keeps its D5 row unchanged.
 * `baseCounted` gives the CC at the base of each `edited` function.
 */
export function applyExceptions(
  judged: readonly Judged[],
  entries: readonly ExceptionEntry[],
  baseCounted: readonly CountedPath[],
  rules: ExceptionRules,
): { readonly functions: GateFunctionReport[]; readonly unused: GateUnusedException[] } {
  const bases = new Map(baseCounted.map((c) => [c.path, c.functions]));
  const applies = entries.filter((e) => e.baseCommit === rules.baseCommit);
  const used = new Set<ExceptionEntry>();
  const functions = judged.map((j) => {
    const mine = applies.filter((e) => names(e, j.row)).sort(byEntry);
    if (mine.length === 0) return j.row;
    for (const entry of mine) used.add(entry);
    const base = baseOf(j.row, bases);
    const baseComplexity = base?.complexity ?? null;
    const uses = mine.map((entry) => ({
      entry,
      outcome: outcomeOf(entry, j, base, rules),
      baseComplexity,
    }));
    const state = stateOf(j, uses, rules.policy.complexityThreshold);
    const exceptions = uses.map((u) =>
      state.state === "incomplete" && u.outcome === "covers"
        ? { ...u, outcome: "incomplete" as const }
        : u,
    );
    return { ...j.row, ...state, exceptions };
  });
  const rows = judged.map((j) => j.row);
  const unused = entries
    .filter((e) => !used.has(e))
    .sort(byEntry)
    .map((entry) => ({ entry, why: unusedWhy(entry, rows, rules.baseCommit) }));
  return { functions, unused };
}

const MEASURES: readonly ExceptionEntry["measure"][] = ["complexity", "crap"];
const KINDS: readonly ExceptionEntry["kind"][] = ["inherited", "approved"];
const TEXTS = ["path", "qualifiedName", "bodyHash", "issue", "approver", "baseCommit"] as const;

/** One entry of the file, or why it is not one. */
function entryOf(raw: unknown): ExceptionEntry | string {
  if (!isRecord(raw)) return "not a JSON object";
  for (const key of TEXTS) {
    if (typeof raw[key] !== "string" || raw[key] === "") return `${key} is not a non-empty string`;
  }
  const { measure, kind, value, issue } = raw;
  if (!MEASURES.includes(measure as never)) return "measure is not complexity or crap";
  if (!KINDS.includes(kind as never)) return "kind is not inherited or approved";
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "value is not a number at or above 0";
  }
  if (!URL.canParse(issue as string)) return "issue is not a URL";
  const text = (key: (typeof TEXTS)[number]) => raw[key] as string;
  return {
    path: text("path"),
    qualifiedName: text("qualifiedName"),
    bodyHash: text("bodyHash"),
    measure: measure as ExceptionEntry["measure"],
    kind: kind as ExceptionEntry["kind"],
    value,
    issue: text("issue"),
    approver: text("approver"),
    baseCommit: text("baseCommit"),
  };
}

/**
 * D8: the entries of an exceptions file's text, or why it is not one: it
 * does not parse, its format is not `squeal-code-exceptions/1`, or an entry
 * lacks a field. Each is a usage error (exit 2).
 */
export function parseExceptions(
  text: string,
): readonly ExceptionEntry[] | { readonly error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { error: `not JSON: ${(error as Error).message}` };
  }
  if (!isRecord(data)) return { error: "not a JSON object" };
  if (data.format !== EXCEPTIONS_FORMAT) {
    return { error: `format is ${JSON.stringify(data.format)}, not "${EXCEPTIONS_FORMAT}"` };
  }
  if (!Array.isArray(data.entries)) return { error: "entries is not a list" };
  const entries: ExceptionEntry[] = [];
  for (const [i, raw] of (data.entries as unknown[]).entries()) {
    const entry = entryOf(raw);
    if (typeof entry === "string") return { error: `entry ${i + 1}: ${entry}` };
    entries.push(entry);
  }
  return entries;
}
