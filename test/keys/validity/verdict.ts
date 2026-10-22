import { isRecord } from "../../../src/core/fs/index.js";
import { sameFingerprint } from "../../../src/core/state/fingerprint.js";
import type { Case, CaseKind, CaseOutput } from "./case.js";
import type { Alarm, Comparison } from "./compare.js";
import { versionName } from "./components.js";

/*
 * The verdict (011 C3, task 011-37 sections 3 and 6). One case's outputs at
 * the two trees: equal keys must give equal outputs, a fingerprint read
 * through `sameFingerprint`; the `store` and adapter kinds read by
 * direction (risk 4, amended 2026-10-20). Each component's version: unchanged, its cases must
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
  /** Under a kind's direction, each file that asks the raise. */
  readonly raised: readonly string[];
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

/** A file as a direction reads it: where its rows are stored (null when not), its state, all it reports. */
interface Filed {
  readonly stored: string | null;
  readonly state: string;
  readonly outputs: unknown;
}

/**
 * D1 (a) reads stored rows, so a kind whose outputs say per file whether
 * its rows are stored reads by direction (risk 4, amended 2026-10-20).
 * Rows the last release stores and the candidate would refuse are rows the
 * candidate would find and trust: that file asks a raise, as one stored
 * alike whose other outputs differ does. A file only the candidate stores
 * (013-02's narrowed barrier, 17 to 18), one stored under another key (a
 * re-key of its checks), and one neither stores change no row a release
 * stored: each is reported.
 */
function byDirection(before: ReadonlyMap<string, Filed>, after: ReadonlyMap<string, Filed>) {
  const raise: string[] = [];
  const reported: string[] = [];
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    const [b, c] = [before.get(file), after.get(file)];
    if (same(b?.outputs, c?.outputs)) continue;
    const told = `${file}: ${b?.state ?? "absent"} at the last release, ${c?.state ?? "absent"} at the candidate`;
    const [bStored, cStored] = [b?.stored ?? null, c?.stored ?? null];
    if (bStored !== null && cStored !== null) {
      if (bStored === cStored) raise.push(`${told}, its other outputs differing`);
      else reported.push(`${told} (a re-key)`);
    } else if (bStored !== null) raise.push(told);
    else if (cStored !== null) reported.push(`${told} (the candidate stores more)`);
    else reported.push(`${told} (neither stores)`);
  }
  return { raise, reported };
}

/** The `store` harness's decisions (`harness/store.ts`), by path: stored where a decision says `store at`. */
function decided(output: CaseOutput): Map<string, Filed> {
  const decisions = isRecord(output.outputs) ? output.outputs.decisions : undefined;
  const all = Array.isArray(decisions) ? (decisions as { path: string; decision: string }[]) : [];
  return new Map(
    all.map((d) => [
      d.path,
      {
        stored: d.decision.startsWith("store at ") ? d.decision : null,
        state: d.decision,
        outputs: d,
      },
    ]),
  );
}

/** One run as an adapter harness reports it (`harness/reported.ts`), each file `project:path`. */
interface Reported {
  readonly completed: readonly string[];
  readonly withheld: readonly string[];
  readonly results: readonly {
    readonly check: string;
    readonly outcome: string;
    readonly fingerprint: string | null;
  }[];
  readonly loadErrors: readonly { readonly file: string; readonly fingerprint: string }[];
  /** The files whose module skipped itself (pytest, 007 D6), which store a skip for each known check. */
  readonly skipped?: readonly string[];
}

const fileOf = (check: string) => {
  const { project, testPath } = JSON.parse(check) as { project: string; testPath: string };
  return `${project}:${testPath}`;
};

/**
 * An adapter harness's runs, by run and file: the scheduler stores a run's
 * completed files (`recordsForFile`), each with its results and its load
 * error, each with its fingerprint, and pytest's whether its module skipped
 * itself.
 */
function ranFiles(output: CaseOutput): Map<string, Filed> {
  const runs = isRecord(output.outputs) ? output.outputs.runs : undefined;
  const filed = new Map<string, Filed>();
  (Array.isArray(runs) ? (runs as Reported[]) : []).forEach((run, i) => {
    const results = run.results.map((r) => [fileOf(r.check), r] as const);
    const files = [
      ...run.completed,
      ...run.withheld,
      ...results.map(([file]) => file),
      ...run.loadErrors.map((e) => e.file),
      ...(run.skipped ?? []),
    ];
    for (const file of new Set(files)) {
      const state = run.completed.includes(file)
        ? "completed"
        : run.withheld.includes(file)
          ? "withheld"
          : "reported";
      const own = results.filter(([f]) => f === file).map(([, r]) => r);
      const loadError = run.loadErrors.find((e) => e.file === file) ?? null;
      const skipped = run.skipped === undefined ? {} : { skipped: run.skipped.includes(file) };
      filed.set(`run ${i + 1}, ${file}`, {
        stored: state === "completed" ? state : null,
        state,
        outputs: { state, results: own, loadError, ...skipped },
      });
    }
  });
  return filed;
}

/** A kind read by direction: its files, and what of its outputs must be equal whatever any file says. */
interface Direction {
  readonly files: (output: CaseOutput) => Map<string, Filed>;
  readonly whole?: (output: CaseOutput) => string;
}

const runCount = (output: CaseOutput) => {
  const runs = isRecord(output.outputs) ? output.outputs.runs : undefined;
  return `${Array.isArray(runs) ? runs.length : 0} runs`;
};

const DIRECTIONS: Partial<Record<CaseKind, Direction>> = {
  store: { files: decided },
  "adapter:vitest": { files: ranFiles, whole: runCount },
  "adapter:pytest": { files: ranFiles, whole: runCount },
};

function directionOf(read: Direction, baseline: CaseOutput, candidate: CaseOutput) {
  const { raise, reported } = byDirection(read.files(baseline), read.files(candidate));
  const [b, c] = [read.whole?.(baseline), read.whole?.(candidate)];
  if (b !== c) raise.push(`${b} at the last release, ${c} at the candidate`);
  return { raise, reported };
}

export function verdictOf(c: Case, baseline: CaseOutput, candidate: CaseOutput): CaseVerdict {
  // A case that throws at one tree only differs whatever its keys.
  const errorsEqual = same(baseline.error, candidate.error);
  const keysEqual = errorsEqual && same(baseline.keys, candidate.keys);
  const read = DIRECTIONS[c.kind];
  const direction =
    read !== undefined && keysEqual ? directionOf(read, baseline, candidate) : undefined;
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
    raised: direction?.raise ?? [],
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
  if (alarm.dependencies !== null && !c.installed) {
    const { baseline, candidate } = alarm.dependencies;
    out.push(
      `${name}: the packages its entries import, or esbuild, moved since ${ref} ` +
        `(${only(baseline, candidate).join(", ")} -> ${only(candidate, baseline).join(", ")}): ` +
        "the last release must be bundled from its own lock; install it into its tree (risk 9)",
    );
  }
  for (const v of differing) {
    const thrown = v.baseline.error ?? v.candidate.error;
    const what =
      thrown === undefined
        ? `equal keys, different outputs at ${ref} and the candidate${v.raised.length > 0 ? ` (${v.raised.join("; ")})` : ""}`
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

/** Outputs that differ and ask no raise (a kind's direction), by case: listed, never failed. */
export function reportedChanges(c: Comparison): string[] {
  return c.cases.flatMap((v) => v.reported.map((line) => `${v.kind} case "${v.name}": ${line}`));
}
