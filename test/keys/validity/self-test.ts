import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";
import type { Case, CaseKind } from "./case.js";
import { CASES } from "./cases/index.js";
import { type Comparison, compareTrees } from "./compare.js";
import { extractTree, lastRelease, type Overlay, ROOT } from "./trees.js";

/*
 * What the comparison's self-tests share (task 011-37 sections 3 and 6): a
 * work directory per test file with the last release extracted into it, and
 * this checkout compared with itself under an overlay, a change unmade, so a
 * self-test holds whatever the checkout changed since the release.
 */

/** A full comparison bundles twice and runs the corpus in four child processes. */
export const SLOW = { timeout: 120_000 };

export const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** `path` with `from` replaced by `to`, which must apply. */
export function edited(path: string, from: string, to: string): Overlay {
  const before = read(path);
  expect(before, `the edit of ${path} no longer applies`).toContain(from);
  return { [path]: before.replace(from, to) };
}

/** The 1-based line of `path` holding `text`. */
export const lineOf = (path: string, text: string) =>
  read(path)
    .split("\n")
    .findIndex((line) => line.includes(text)) + 1;

/** The corpus's cases of `kinds`: a self-test runs the kinds its change reaches. */
export const only = (...kinds: CaseKind[]) => CASES.filter((c) => kinds.includes(c.kind));

export interface Comparisons {
  /** The last release's tag. */
  release(): string;
  /** Its tree, extracted. */
  tree(): string;
  /** This checkout against `baseline`, itself by default, under `overlay`. */
  compare(overlay: Overlay, cases?: readonly Case[], baseline?: string): Promise<Comparison>;
}

/** Registers the work directory's setup and removal; call at a test file's top level. */
export function comparisons(): Comparisons {
  let work: string | undefined;
  let release = "";
  let runs = 0;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "squeal-validity-"));
    release = lastRelease();
    extractTree(release, join(work, "release"));
  });
  afterAll(() => {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });
  const dir = () => {
    if (work === undefined) throw new Error("comparisons() runs its setup in beforeAll");
    return work;
  };
  return {
    release: () => release,
    tree: () => join(dir(), "release"),
    compare: (overlay, cases = CASES, baseline = ROOT) =>
      compareTrees({ baseline, cases, overlay, work: join(dir(), `run-${runs++}`) }),
  };
}
