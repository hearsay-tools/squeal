import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isRecord } from "../../../src/core/fs/index.js";
import { sameFingerprint } from "../../../src/core/state/fingerprint.js";
import { type Bundle, bundleDriver } from "./bundle.js";
import type { Case, CaseKind, CaseOutput } from "./case.js";
import { changedLines, changedSources, coverageOf, mappedLines, unrun } from "./coverage.js";
import { dependencyLines, formatVersionOf, type Overlay, ROOT } from "./trees.js";

/*
 * The comparison (011 C3, task 011-37 section 3): the driver bundled at the
 * last release and at the candidate; when the two differ, every case run at
 * both, outputs compared where keys are equal, and every changed line
 * required to have run in some case.
 */

/** The version a kind's differing outputs ask to raise. */
export const MOVES: Readonly<Record<CaseKind, string>> = {
  key: "KEY_FORMAT_VERSION (src/core/keys/key-format.ts)",
  rows: "KEY_FORMAT_VERSION (src/core/keys/key-format.ts)",
};

export interface CaseVerdict {
  readonly name: string;
  readonly kind: CaseKind;
  readonly keysEqual: boolean;
  /** Outputs equal where keys are; `true` when keys differ, since nothing stored is found then. */
  readonly outputsEqual: boolean;
  readonly wordingEqual: boolean;
  readonly baseline: CaseOutput;
  readonly candidate: CaseOutput;
}

export interface Comparison {
  readonly versions: { readonly baseline: number; readonly candidate: number };
  /** The bundles' text or the packages they import differ. */
  readonly fired: boolean;
  /** Each tree's package lines, when they differ. */
  readonly dependencies: { readonly baseline: string[]; readonly candidate: string[] } | null;
  readonly cases: readonly CaseVerdict[];
  /** Changed lines no case ran, `source:line (bundle side:line)`. */
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

interface SideRun {
  readonly tree: string;
  readonly map: Bundle["map"];
  readonly bundle: Bundle;
  readonly file: string;
  readonly outputs: Record<string, CaseOutput>;
  readonly coverage: ReturnType<typeof coverageOf>;
}

function prepare(work: string, side: string, bundle: Bundle): string {
  const dir = join(work, side);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "driver.mjs");
  writeFileSync(file, bundle.text);
  return file;
}

/** Runs every case at one side's bundle, under V8 coverage, with HOME and XDG_* inside `work`. */
function run(work: string, side: string, file: string, cases: readonly Case[]) {
  const dir = join(work, side);
  const home = join(work, "home");
  const casesFile = join(dir, "cases.json");
  const outFile = join(dir, "out.json");
  const coverage = join(dir, "coverage");
  writeFileSync(casesFile, JSON.stringify(cases));
  const child = spawnSync(process.execPath, [file, casesFile, outFile, join(dir, "scratch")], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_STATE_HOME: join(home, ".local/state"),
      NODE_V8_COVERAGE: coverage,
    },
  });
  if (child.status !== 0) throw new Error(`the ${side} driver failed:\n${child.stderr}`);
  const outputs = JSON.parse(readFileSync(outFile, "utf8")) as Record<string, CaseOutput>;
  return { outputs, coverage: coverageOf(coverage, pathToFileURL(file).href) };
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
  const deps = {
    baseline: dependencyLines(baseline, bundles.baseline.packages),
    candidate: dependencyLines(candidate, bundles.candidate.packages),
  };
  const dependencies = same(deps.baseline, deps.candidate) ? null : deps;
  const fired = bundles.baseline.text !== bundles.candidate.text || dependencies !== null;
  if (!fired) return { versions, fired, dependencies, cases: [], uncovered: [] };

  const trees = { baseline, candidate };
  const sides = {} as Record<"baseline" | "candidate", SideRun>;
  for (const side of ["baseline", "candidate"] as const) {
    const file = prepare(work, side, bundles[side]);
    sides[side] = {
      tree: trees[side],
      map: bundles[side].map,
      bundle: bundles[side],
      file,
      ...run(work, side, file, cases),
    };
  }
  const verdicts = cases.map((c) =>
    verdictOf(c, sides.baseline.outputs[c.name] ?? {}, sides.candidate.outputs[c.name] ?? {}),
  );
  return { versions, fired, dependencies, cases: verdicts, uncovered: uncoveredOf(work, sides) };
}

/** Each changed line that ran in no case, at the side that holds it. */
function uncoveredOf(work: string, sides: Record<"baseline" | "candidate", SideRun>): string[] {
  const bundles = changedLines(sides.baseline.file, sides.candidate.file);
  const sources = changedSources(sides.baseline, sides.candidate, join(work, "diff"));
  const out: string[] = [];
  for (const [side, lines] of [
    ["baseline", bundles.removed],
    ["candidate", bundles.added],
  ] as const) {
    const { tree, bundle, coverage } = sides[side];
    const mapped = mappedLines(bundle.map, tree);
    const changedFrom = (line: number) =>
      (mapped.get(line) ?? []).filter((at) => sources[side].has(at));
    const required = lines.filter((line) => changedFrom(line).length > 0);
    for (const line of unrun(bundle.text, coverage, required)) {
      out.push(`${changedFrom(line).join(", ")} (${side} bundle line ${line})`);
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
    out.push(
      `${v.kind} case "${v.name}": equal keys, different outputs at ${ref} and the candidate; ` +
        `raise ${MOVES[v.kind]}`,
    );
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
