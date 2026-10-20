import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/core/fs/index.js";
import { sameFingerprint } from "../../../src/core/state/fingerprint.js";
import { bundleDriver } from "./bundle.js";
import type { Case, CaseKind, CaseOutput } from "./case.js";
import { changedLines, changedSources, mappedLines, unrun } from "./coverage.js";
import { coverageAt, execute, prepare, runtimeTexts, type Side, type SideName } from "./sides.js";
import { dependencyLines, formatVersionOf, type Overlay, ROOT } from "./trees.js";

/*
 * The comparison (011 C3, task 011-37 section 3): the driver bundled at the
 * last release and at the candidate; when the two differ, every case run at
 * both, outputs compared where keys are equal, and every changed line
 * required to have run in some case.
 */

const FORMAT = "KEY_FORMAT_VERSION (src/core/keys/key-format.ts)";

/** The version a kind's differing outputs ask to raise. */
export const MOVES: Readonly<Record<CaseKind, string>> = {
  key: FORMAT,
  rows: FORMAT,
  accept: FORMAT,
  assemble: FORMAT,
  store: FORMAT,
  observe: "RECORDER_VERSION (src/runners/observe/runtime.ts)",
};

export interface CaseVerdict {
  readonly name: string;
  readonly kind: CaseKind;
  readonly keysEqual: boolean;
  /** Outputs equal where keys are, and no case threw at one tree only. */
  readonly outputsEqual: boolean;
  readonly wordingEqual: boolean;
  readonly baseline: CaseOutput;
  readonly candidate: CaseOutput;
}

export interface Comparison {
  readonly versions: { readonly baseline: number; readonly candidate: number };
  /** The bundles' text, the packages they import or the recorder's runtime differ. */
  readonly fired: boolean;
  /** Each tree's package lines, when they differ. */
  readonly dependencies: { readonly baseline: string[]; readonly candidate: string[] } | null;
  readonly cases: readonly CaseVerdict[];
  /** Changed lines no case ran, `source:line (side file:line)`. */
  readonly uncovered: readonly string[];
}

export interface CompareOptions {
  /** The last release's extracted tree. */
  readonly baseline: string;
  /** The candidate's tree; this checkout by default. */
  readonly candidate?: string;
  /** Texts in place of the candidate's files. */
  readonly overlay?: Overlay;
  readonly cases: readonly Case[];
  /** An empty directory for bundles, runs and stores. */
  readonly work: string;
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

function verdictOf(c: Case, baseline: CaseOutput, candidate: CaseOutput): CaseVerdict {
  // A case that throws at one tree only differs whatever its keys.
  const errorsEqual = same(baseline.error, candidate.error);
  const keysEqual = errorsEqual && same(baseline.keys, candidate.keys);
  const outputsEqual = errorsEqual && (!keysEqual || same(baseline.outputs, candidate.outputs));
  return {
    name: c.name,
    kind: c.kind,
    keysEqual,
    outputsEqual,
    wordingEqual: same(baseline.wording, candidate.wording),
    baseline,
    candidate,
  };
}

/** Bundles both trees and, when they differ, runs the corpus at both and checks coverage. */
export async function compareTrees(options: CompareOptions): Promise<Comparison> {
  const { baseline, work, cases } = options;
  const candidate = options.candidate ?? ROOT;
  const overlay = options.overlay ?? {};
  mkdirSync(work, { recursive: true });
  // The bundles import packages: both resolve them from the candidate's install.
  if (!existsSync(join(work, "node_modules"))) {
    symlinkSync(join(ROOT, "node_modules"), join(work, "node_modules"), "dir");
  }
  const versions = {
    baseline: formatVersionOf(baseline),
    candidate: formatVersionOf(candidate, overlay),
  };
  const bundles = {
    baseline: await bundleDriver(baseline, join(work, "baseline/driver.mjs")),
    candidate: await bundleDriver(candidate, join(work, "candidate/driver.mjs"), overlay),
  };
  const runtime = { baseline: runtimeTexts(baseline), candidate: runtimeTexts(candidate, overlay) };
  const deps = {
    baseline: dependencyLines(baseline, bundles.baseline.packages),
    candidate: dependencyLines(candidate, bundles.candidate.packages),
  };
  const dependencies = same(deps.baseline, deps.candidate) ? null : deps;
  const fired =
    bundles.baseline.text !== bundles.candidate.text ||
    dependencies !== null ||
    !same(Object.fromEntries(runtime.baseline), Object.fromEntries(runtime.candidate));
  if (!fired) return { versions, fired, dependencies, cases: [], uncovered: [] };

  const sides: Record<SideName, Side> = {
    baseline: prepare(work, "baseline", baseline, bundles.baseline, runtime.baseline),
    candidate: prepare(work, "candidate", candidate, bundles.candidate, runtime.candidate),
  };
  const runtimeDir = (side: Side) => join(side.dir, "observe");
  const outputs = {
    baseline: execute(work, sides.baseline, "run", cases, runtimeDir(sides.baseline)),
    candidate: execute(work, sides.candidate, "run", cases, runtimeDir(sides.candidate)),
  };
  // D1 (a): the candidate decides over the store each tree wrote from the same runs.
  for (const name of ["baseline", "candidate"] as const) {
    const label = `decide-${name}`;
    const stored = storedFor(sides[name], cases, label);
    const decided = execute(work, sides.candidate, "decide", cases, stored, label);
    for (const [c, output] of Object.entries(decided)) {
      if (outputs[name][c]?.error === undefined) outputs[name][c] = output;
    }
  }
  // For coverage only: the release decides over its own store too, so a line
  // its decisions removed is held to the same proof. Its outputs are dropped;
  // the compared ones stay D1 (a)'s (review of cand/0.1.228, B1).
  const own = storedFor(sides.baseline, cases, "decide-own");
  execute(work, sides.baseline, "decide", cases, own, "decide-own");
  const verdicts = cases.map((c) =>
    verdictOf(c, outputs.baseline[c.name] ?? {}, outputs.candidate[c.name] ?? {}),
  );
  const uncovered = [...uncoveredInBundles(work, sides, overlay), ...uncoveredInRuntime(sides)];
  return { versions, fired, dependencies, cases: verdicts, uncovered };
}

/**
 * A copy of the stores `side`'s run wrote, for one decision: a lookup
 * writes (a set copied from a format read as one, a last-used time), so a
 * decision over the run's own stores would leave the next one a store the
 * run did not write (row 011-40).
 */
function storedFor(side: Side, cases: readonly Case[], label: string): string {
  const copy = join(side.dir, `${label}-stored`);
  for (const at of cases.keys()) {
    const store = join(side.dir, "run", String(at), "store");
    if (existsSync(store)) cpSync(store, join(copy, String(at), "store"), { recursive: true });
  }
  return copy;
}

/** Each changed bundle line from a changed source line that ran in no case, at the side that holds it. */
function uncoveredInBundles(
  work: string,
  sides: Record<SideName, Side>,
  overlay: Overlay,
): string[] {
  const bundles = changedLines(sides.baseline.file, sides.candidate.file);
  const sources = changedSources(
    { map: sides.baseline.bundle.map, tree: sides.baseline.tree },
    { map: sides.candidate.bundle.map, tree: sides.candidate.tree, overlay },
    join(work, "diff"),
  );
  const out: string[] = [];
  for (const [name, lines] of [
    ["baseline", bundles.removed],
    ["candidate", bundles.added],
  ] as const) {
    const side = sides[name];
    const mapped = mappedLines(side.bundle.map, side.tree);
    const changedFrom = (line: number) =>
      (mapped.get(line) ?? []).filter((at) => sources[name].has(at));
    const required = lines.filter((line) => changedFrom(line).length > 0);
    for (const line of unrun(side.bundle.text, coverageAt(side, side.file), required)) {
      out.push(`${changedFrom(line).join(", ")} (${name} bundle line ${line})`);
    }
  }
  return out;
}

const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

/** Each changed code line of the recorder's runtime that ran in no case, at the side that holds it. */
function uncoveredInRuntime(sides: Record<SideName, Side>): string[] {
  const out: string[] = [];
  const paths = new Set([...sides.baseline.runtime.keys(), ...sides.candidate.runtime.keys()]);
  for (const path of paths) {
    const [from, to] = [sides.baseline.runtime.get(path), sides.candidate.runtime.get(path)];
    const text = (file: string | undefined) =>
      file === undefined ? "" : readFileSync(file, "utf8");
    if (text(from) === text(to)) continue;
    const all = (file: string) =>
      text(file)
        .split("\n")
        .map((_, i) => i + 1);
    const changed =
      from !== undefined && to !== undefined
        ? changedLines(from, to)
        : { removed: from === undefined ? [] : all(from), added: to === undefined ? [] : all(to) };
    for (const [name, file, lines] of [
      ["baseline", from, changed.removed],
      ["candidate", to, changed.added],
    ] as const) {
      if (file === undefined) continue;
      const source = text(file).split("\n");
      const code = lines.filter((n) => !COMMENT.test(source[n - 1] ?? ""));
      for (const line of unrun(text(file), coverageAt(sides[name], file), code)) {
        out.push(`${path}:${line} (${name} runtime)`);
      }
    }
  }
  return out;
}

/**
 * Why the comparison fails, empty when it passes. Under the last release's
 * version, outputs at equal keys must be equal and every changed line must
 * have run. A raised version is reported, not failed: until the alarm
 * replaces the guard (row 011-41), the guard forces a raise for any change,
 * and this comparison is the evidence that a raised format reads as one.
 */
export function failures(c: Comparison, ref: string): string[] {
  if (c.versions.candidate !== c.versions.baseline) return [];
  const out: string[] = [];
  if (c.dependencies !== null) {
    const only = (a: string[], b: string[]) => a.filter((l) => !b.includes(l));
    out.push(
      `the packages the bundle imports, or esbuild, moved since ${ref} ` +
        `(${only(c.dependencies.baseline, c.dependencies.candidate).join(", ")} -> ` +
        `${only(c.dependencies.candidate, c.dependencies.baseline).join(", ")}): ` +
        "the last release must be bundled from its own lock",
    );
  }
  for (const v of c.cases.filter((v) => !v.outputsEqual)) {
    const thrown = v.baseline.error ?? v.candidate.error;
    const what =
      thrown === undefined
        ? `equal keys, different outputs at ${ref} and the candidate`
        : `throws at ${v.baseline.error === undefined ? "the candidate" : ref} only: ${thrown}`;
    out.push(`${v.kind} case "${v.name}": ${what}; raise ${MOVES[v.kind]}`);
  }
  if (c.uncovered.length > 0) {
    out.push(
      `changed lines no case runs, each needing a case under test/keys/validity/cases/: ${c.uncovered.join("; ")}`,
    );
  }
  return out;
}

/** The wording that differs at equal keys and outputs: listed, never failed. */
export function wordingChanges(c: Comparison): string[] {
  return c.cases.filter((v) => v.keysEqual && v.outputsEqual && !v.wordingEqual).map((v) => v.name);
}
