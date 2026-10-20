import { isRecord } from "../../../src/core/fs/index.js";
import { sameFingerprint } from "../../../src/core/state/fingerprint.js";
import type { Case, CaseKind, CaseOutput } from "./case.js";
import type { Alarm, Comparison } from "./compare.js";
import { versionName } from "./components.js";

/*
 * The verdict (011 C3, task 011-37 sections 3 and 6). One case's outputs at
 * the two trees: equal keys must give equal outputs, a fingerprint read
 * through `sameFingerprint`; the `store` kind reads by direction (risk 4,
 * amended 2026-10-20). Each component's version: unchanged, its cases must
 * agree and its changed lines must have run; raised, one of its cases must
 * differ (D6), and a raised format empties the formats read as one (risk 6).
 */

export interface CaseVerdict {
  readonly name: string;
  readonly kind: CaseKind;
  readonly keysEqual: boolean;
  /** Outputs equal where keys are, as the kind reads them, and no case threw at one tree only. */
  readonly outputsEqual: boolean;
  readonly wordingEqual: boolean;
  /** Outputs that differ and ask no raise, each why: listed, never failed. */
  readonly reported: readonly string[];
  readonly baseline: CaseOutput;
  readonly candidate: CaseOutput;
}

/** Deep equality, a `fingerprint` field read through the candidate's `sameFingerprint`. */
export function same(a: unknown, b: unknown, field?: string): boolean {
  const fingerprint = (v: unknown) => typeof v === "string" || v === null;
  if (field === "fingerprint" && fingerprint(a) && fingerprint(b)) {
    return sameFingerprint(a as string | null, b as string | null);
  }
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => same(a[k], b[k], k));
  }
  return false;
}

/** One file's decision as the `store` harness names it (`harness/store.ts`). */
interface Decided {
  readonly path: string;
  readonly decision: string;
  readonly grown: boolean;
  readonly current: boolean;
}

const STORED = "store at ";

const decisionsOf = (output: CaseOutput): readonly Decided[] =>
  isRecord(output.outputs) && Array.isArray(output.outputs.decisions)
    ? (output.outputs.decisions as Decided[])
    : [];

/**
 * The `store` kind by direction, as D1 (a) reads decisions over the last
 * release's store: rows the last release stores and the candidate would
 * refuse are rows the candidate would find and trust, so that file asks a
 * raise. A file the candidate stores and the last release did not (013-02's
 * narrowed barrier, 17 to 18), one stored under another key (a re-key of
 * its checks), and one neither stores but each decides otherwise change no
 * stored row: each is reported. Stored alike under one key, any other
 * difference (current, growth kept) asks a raise.
 */
function storeDirection(baseline: CaseOutput, candidate: CaseOutput) {
  const raise: string[] = [];
  const reported: string[] = [];
  const at = new Map(decisionsOf(candidate).map((d) => [d.path, d]));
  const paths = new Set([...decisionsOf(baseline).map((d) => d.path), ...at.keys()]);
  const before = new Map(decisionsOf(baseline).map((d) => [d.path, d]));
  for (const path of paths) {
    const [b, c] = [before.get(path), at.get(path)];
    if (same(b, c)) continue;
    const told = `${path}: ${b?.decision ?? "absent"} at the last release, ${c?.decision ?? "absent"} at the candidate`;
    const [bStored, cStored] = [b, c].map((d) => d?.decision.startsWith(STORED) === true);
    if (bStored && cStored && b?.decision !== c?.decision) reported.push(`${told} (a re-key)`);
    else if (bStored) raise.push(told);
    else if (cStored) reported.push(`${told} (the candidate stores more)`);
    else reported.push(`${told} (neither stores)`);
  }
  return { raise, reported };
}

export function verdictOf(c: Case, baseline: CaseOutput, candidate: CaseOutput): CaseVerdict {
  // A case that throws at one tree only differs whatever its keys.
  const errorsEqual = same(baseline.error, candidate.error);
  const keysEqual = errorsEqual && same(baseline.keys, candidate.keys);
  const direction =
    c.kind === "store" && keysEqual ? storeDirection(baseline, candidate) : undefined;
  const outputsEqual =
    errorsEqual &&
    (!keysEqual ||
      (direction === undefined
        ? same(baseline.outputs, candidate.outputs)
        : direction.raise.length === 0));
  return {
    name: c.name,
    kind: c.kind,
    keysEqual,
    outputsEqual,
    wordingEqual: same(baseline.wording, candidate.wording),
    reported: direction?.reported ?? [],
    baseline,
    candidate,
  };
}

const only = (a: readonly string[], b: readonly string[]) => a.filter((l) => !b.includes(l));

/** Why `alarm`'s component fails, empty when it passes. */
function componentFailures(c: Comparison, alarm: Alarm, ref: string): string[] {
  const { component, versions } = alarm;
  const name = versionName(component);
  const own = c.cases.filter((v) => component.kinds.includes(v.kind));
  const differing = own.filter((v) => !v.outputsEqual);
  if (versions.candidate !== versions.baseline) {
    const out: string[] = [];
    if (differing.length === 0) {
      const kinds = component.kinds.length === 0 ? "no" : `no ${component.kinds.join(", ")}`;
      out.push(
        `${name} moved from ${versions.baseline} at ${ref} to ${versions.candidate}, and ${kinds} case's outputs differ: ` +
          "a raise needs a case whose outputs differ (task 011-37 D6); add the case under " +
          `test/keys/validity/cases/ that shows the change of stored meaning, or keep ${versions.baseline}`,
      );
    }
    if (component.name === "global" && c.readAsOne.length > 0) {
      out.push(
        `KEY_FORMAT_VERSION moved for a change of stored meaning, so no earlier format reads as ${versions.candidate}: ` +
          `empty KEY_FORMATS_READ_AS_ONE, which lists ${c.readAsOne.join(", ")} (011 C3, task 011-37 risk 6)`,
      );
    }
    return out;
  }
  const out: string[] = [];
  if (alarm.dependencies !== null) {
    const { baseline, candidate } = alarm.dependencies;
    out.push(
      `${name}: the packages its entries import, or esbuild, moved since ${ref} ` +
        `(${only(baseline, candidate).join(", ")} -> ${only(candidate, baseline).join(", ")}): ` +
        "the last release must be bundled from its own lock",
    );
  }
  for (const v of differing) {
    const thrown = v.baseline.error ?? v.candidate.error;
    const what =
      thrown === undefined
        ? `equal keys, different outputs at ${ref} and the candidate`
        : `throws at ${v.baseline.error === undefined ? "the candidate" : ref} only: ${thrown}`;
    out.push(`${v.kind} case "${v.name}": ${what}; raise ${name}`);
  }
  if (alarm.uncovered.length > 0) {
    out.push(
      `${name}: changed lines no case runs, each needing a case under test/keys/validity/cases/: ${alarm.uncovered.join("; ")}`,
    );
  }
  return out;
}

/**
 * Why the comparison fails, empty when it passes, per component. An empty
 * list under a raised version proves no coverage: a raise is held to D6
 * and the list's rule, not to its changed lines (the review of format 18).
 */
export function failures(c: Comparison, ref: string): string[] {
  return c.alarms.flatMap((alarm) => componentFailures(c, alarm, ref));
}

/** The wording that differs at equal keys and outputs: listed, never failed. */
export function wordingChanges(c: Comparison): string[] {
  return c.cases.filter((v) => v.keysEqual && v.outputsEqual && !v.wordingEqual).map((v) => v.name);
}

/** Outputs that differ and ask no raise (the `store` kind's direction), by case: listed, never failed. */
export function reportedChanges(c: Comparison): string[] {
  return c.cases.flatMap((v) => v.reported.map((line) => `${v.kind} case "${v.name}": ${line}`));
}
