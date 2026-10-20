import { isRecord } from "../../../src/core/fs/index.js";
import { sameFingerprint } from "../../../src/core/state/fingerprint.js";
import type { Case, CaseKind, CaseOutput } from "./case.js";

/*
 * How one case's outputs at the two trees are read (011 C3, task 011-37
 * section 3): equal keys must give equal outputs, a fingerprint read through
 * `sameFingerprint`; the `store` kind reads by direction (risk 4, amended
 * 2026-10-20).
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
