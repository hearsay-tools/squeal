import { cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundleDriver, bundleEntries } from "./bundle.js";
import type { Case } from "./case.js";
import { COMPONENTS, type Component, componentOf } from "./components.js";
import { changedLines, changedSources, mappedLines, unrun } from "./coverage.js";
import { esbuildOf, type Install, installLock } from "./lock.js";
import { pythonsFor } from "./python.js";
import {
  allEnded,
  coverageAt,
  driverFile,
  launch,
  prepare,
  runSide,
  type Side,
  type SideName,
  textsOf,
} from "./sides.js";
import { dependencyLines, type Overlay, ROOT, readAsOneOf, versionOf } from "./trees.js";
import { type CaseVerdict, same, verdictOf } from "./verdict.js";

export type { CaseVerdict } from "./verdict.js";
export { failures, reportedChanges, wordingChanges } from "./verdict.js";

/*
 * The comparison (011 C3, task 011-37 sections 2 and 3): each component's
 * entries bundled at the last release and at the candidate, the alarm; when
 * one fires, every case run at both through one driver bundle that holds
 * them all, outputs compared where keys are equal, and every changed line
 * required to have run in some case, held to the components whose entries
 * hold it.
 */

/** One component's alarm. */
export interface Alarm {
  readonly component: Component;
  /** Its version as each tree states it. */
  readonly versions: { readonly baseline: string; readonly candidate: string };
  /** Its entries' emitted code, its text files or its packages' lock lines differ. */
  readonly fired: boolean;
  /** Each tree's lock lines of the packages its entries import, and the bundler's, when they differ. */
  readonly dependencies: { readonly baseline: string[]; readonly candidate: string[] } | null;
  /** Its changed lines no case ran, `source:line (side file:line)`. */
  readonly uncovered: readonly string[];
}

export interface Comparison {
  readonly alarms: readonly Alarm[];
  /** Some alarm fired, so the corpus ran. */
  readonly fired: boolean;
  /** The packages moved, and the last release's lock was installed into its tree for its side (risk 9). */
  readonly installed: boolean;
  /** The formats the candidate reads as its own (`KEY_FORMATS_READ_AS_ONE`). */
  readonly readAsOne: readonly number[];
  readonly cases: readonly CaseVerdict[];
  /** Every changed line no case ran, whatever holds it. */
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
  /** Installs the last release's lock when the packages moved; `null` reports that it must be (risk 9). */
  readonly install?: Install | null;
}

/** A changed line no case ran, and the sources it was emitted from. */
interface Unrun {
  readonly sources: readonly string[];
  readonly text: string;
}

/** What one component's entries hold at each tree, and whether its alarm fires. */
async function alarmOf(
  component: Component,
  baseline: string,
  candidate: string,
  overlay: Overlay,
) {
  const bundles = {
    baseline: await bundleEntries(baseline, component.entries),
    candidate: await bundleEntries(candidate, component.entries, overlay),
  };
  const texts = {
    baseline: textsOf(baseline, component.texts),
    candidate: textsOf(candidate, component.texts, overlay),
  };
  const deps = {
    baseline: dependencyLines(baseline, bundles.baseline.packages),
    candidate: dependencyLines(candidate, bundles.candidate.packages, overlay),
  };
  const dependencies = same(deps.baseline, deps.candidate) ? null : deps;
  const fired =
    bundles.baseline.text !== bundles.candidate.text ||
    dependencies !== null ||
    !same(Object.fromEntries(texts.baseline), Object.fromEntries(texts.candidate));
  const holds = new Set([...bundles.baseline.inputs, ...bundles.candidate.inputs]);
  const versions = {
    baseline: versionOf(baseline, component),
    candidate: versionOf(candidate, component, overlay),
  };
  return { component, versions, fired, dependencies, holds, texts };
}

/** Bundles each component's entries at both trees and, when one differs, runs the corpus and checks coverage. */
export async function compareTrees(options: CompareOptions): Promise<Comparison> {
  const { baseline, work } = options;
  const candidate = options.candidate ?? ROOT;
  const overlay = options.overlay ?? {};
  mkdirSync(work, { recursive: true });
  // The bundles import packages: both resolve them from the candidate's install.
  if (!existsSync(join(work, "node_modules"))) {
    symlinkSync(join(ROOT, "node_modules"), join(work, "node_modules"), "dir");
  }
  const found = await Promise.all(
    COMPONENTS.map((component) => alarmOf(component, baseline, candidate, overlay)),
  );
  const readAsOne = readAsOneOf(candidate, overlay);
  const fired = found.some((a) => a.fired);
  if (!fired) {
    const alarms = found.map(({ holds: _, texts: __, ...alarm }) => ({ ...alarm, uncovered: [] }));
    return { alarms, fired, installed: false, readAsOne, cases: [], uncovered: [] };
  }
  const install = options.install === undefined ? installLock : options.install;
  const installed = install !== null && found.some((a) => a.dependencies !== null);
  if (installed) install(baseline);
  // An adapter's cases run real runners: only when its own alarm fired.
  const firedKind = (c: Case) =>
    !c.kind.startsWith("adapter:") ||
    found.some((a) => a.fired && a.component === componentOf(c.kind));
  const cases = options.cases.filter(firedKind);

  const outfile = (name: SideName) => driverFile(join(work, name));
  const bundles = {
    baseline: installed
      ? await bundleDriver(baseline, outfile("baseline"), {}, await esbuildOf(baseline))
      : await bundleDriver(baseline, outfile("baseline")),
    candidate: await bundleDriver(candidate, outfile("candidate"), overlay),
  };
  // Each side's runtimes, from its components' texts (`sides.ts`).
  const texts = (name: SideName) => new Map(found.flatMap((a) => [...a.texts[name]]));
  const sides: Record<SideName, Side> = {
    baseline: prepare(work, "baseline", baseline, bundles.baseline, texts("baseline")),
    candidate: prepare(work, "candidate", candidate, bundles.candidate, texts("candidate")),
  };
  // The installed release resolves its packages from its own tree, Vitest among them.
  if (installed)
    symlinkSync(join(baseline, "node_modules"), join(sides.baseline.dir, "node_modules"), "dir");
  // Row 011-48: the pytest cases' environments, one per Python, shared by both sides.
  const pythons = pythonsFor(cases, work);
  const [baselineRun, candidateRun] = await allEnded([
    runSide(work, sides.baseline, cases, pythons),
    runSide(work, sides.candidate, cases, pythons),
  ]);
  const outputs = { baseline: baselineRun, candidate: candidateRun };
  // D1 (a): the candidate decides over the store each tree wrote from the same runs.
  // For coverage only: the release decides over its own store too, so a line
  // its decisions removed is held to the same proof. Its outputs are dropped;
  // the compared ones stay D1 (a)'s (review of cand/0.1.228, B1).
  const decide = (side: Side, over: SideName, label: string) =>
    launch(work, side, "decide", cases, storedFor(sides[over], cases, label), label);
  const [byBaseline, byCandidate] = await allEnded([
    decide(sides.candidate, "baseline", "decide-baseline"),
    decide(sides.candidate, "candidate", "decide-candidate"),
    decide(sides.baseline, "baseline", "decide-own"),
  ]);
  for (const [name, decided] of [
    ["baseline", byBaseline],
    ["candidate", byCandidate],
  ] as const) {
    for (const [c, output] of Object.entries(decided)) {
      if (outputs[name][c]?.error === undefined) outputs[name][c] = output;
    }
  }
  const verdicts = cases.map((c) =>
    verdictOf(c, outputs.baseline[c.name] ?? {}, outputs.candidate[c.name] ?? {}),
  );
  const inBundles = uncoveredInBundles(work, sides, overlay);
  const alarms = found.map(({ holds, texts, ...alarm }) => {
    const pathOf = (source: string) => source.slice(0, source.lastIndexOf(":"));
    const held = inBundles.filter((u) => u.sources.some((s) => holds.has(pathOf(s))));
    const inTexts = uncoveredInTexts(work, alarm.component, texts, sides);
    return { ...alarm, uncovered: [...held, ...inTexts].map((u) => u.text) };
  });
  const uncovered = [
    ...new Set([...inBundles.map((u) => u.text), ...alarms.flatMap((a) => a.uncovered)]),
  ];
  return { alarms, fired, installed, readAsOne, cases: verdicts, uncovered };
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
): Unrun[] {
  const bundles = changedLines(sides.baseline.file, sides.candidate.file);
  const sources = changedSources(
    { map: sides.baseline.bundle.map, tree: sides.baseline.tree },
    { map: sides.candidate.bundle.map, tree: sides.candidate.tree, overlay },
    join(work, "diff"),
  );
  const out: Unrun[] = [];
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
      const sources = changedFrom(line);
      out.push({ sources, text: `${sources.join(", ")} (${name} bundle line ${line})` });
    }
  }
  return out;
}

const COMMENT = /^\s*(?:\/\/|\/\*|\*|#)/;

/**
 * Each changed code line of `component`'s text files that ran in no case,
 * at the side that holds it. The recorder's runtime (the `observe` kind) and
 * the pytest runtime (`adapter:pytest`, through Python's trace) run in
 * cases, from their copies beside the side's driver; a line of any other
 * text file has run in none.
 */
function uncoveredInTexts(
  work: string,
  component: Component,
  texts: Record<SideName, ReadonlyMap<string, string>>,
  sides: Record<SideName, Side>,
): Unrun[] {
  const out: Unrun[] = [];
  const dir = join(work, "texts", component.name.replace(/\W/g, "-"));
  mkdirSync(dir, { recursive: true });
  for (const path of new Set([...texts.baseline.keys(), ...texts.candidate.keys()])) {
    const [a, b] = [texts.baseline.get(path), texts.candidate.get(path)];
    if (a === b) continue;
    const fileOf = (name: SideName, text: string | undefined) => {
      if (text === undefined) return undefined;
      const copy = sides[name].runtime.get(path);
      if (copy !== undefined) return copy;
      const file = join(dir, `${name}-${path.replace(/\//g, "_")}`);
      writeFileSync(file, text);
      return file;
    };
    const [from, to] = [fileOf("baseline", a), fileOf("candidate", b)];
    const all = (text: string) => text.split("\n").map((_, i) => i + 1);
    const changed =
      from !== undefined && to !== undefined
        ? changedLines(from, to)
        : { removed: a === undefined ? [] : all(a), added: b === undefined ? [] : all(b) };
    for (const [name, file, text, lines] of [
      ["baseline", from, a, changed.removed],
      ["candidate", to, b, changed.added],
    ] as const) {
      if (file === undefined || text === undefined) continue;
      const source = text.split("\n");
      const code = lines.filter((n) => !COMMENT.test(source[n - 1] ?? ""));
      const ran = sides[name].runtime.has(path) ? coverageAt(sides[name], file) : [];
      for (const line of unrun(text, ran, code)) {
        out.push({ sources: [`${path}:${line}`], text: `${path}:${line} (${name} runtime)` });
      }
    }
  }
  return out;
}
