import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";
import { findPython, PYTHONS } from "../../helpers/pytest-env.js";
import type { Case, CaseKind } from "./case.js";
import { CASES } from "./cases/index.js";
import { type Comparison, compareTrees } from "./compare.js";
import type { Install } from "./lock.js";
import { extractTree, lastRelease, type Overlay, ROOT } from "./trees.js";

/*
 * What the comparison's self-tests share (task 011-37 sections 3 and 6): a
 * work directory per test file with the last release extracted into it, and
 * this checkout compared with itself under an overlay, a change unmade, so a
 * self-test holds whatever the checkout changed since the release.
 */

/** A full comparison bundles twice, runs the corpus in four drivers at once and decides in three. */
export const SLOW = { timeout: 120_000 };

/** A comparison that may run the whole corpus, the pytest cases on two Pythons among them (row 011-48). */
export const FULL = { timeout: 300_000 };

/**
 * The work directory's removal at the end of a file (row 011-179): a full
 * corpus's comparison leaves some 13,000 files, mostly each pytest case's
 * bytecode, which took more than Vitest's 10 s hook timeout at load 59 to 99.
 */
export const REMOVAL = { timeout: 120_000 };

/**
 * Whether uv holds every Python the `adapter:pytest` kind runs on. On CI an
 * absent one throws, so a broken setup cannot hide the kind (as
 * `requireSynced` does for the pytest suite).
 */
export function pythonsReady(): boolean {
  const missing = PYTHONS.map(findPython).flatMap((found) => (found.ok ? [] : [found.reason]));
  if (missing.length > 0 && process.env.CI) {
    throw new Error(`pytest's Pythons are unavailable on CI: ${missing.join("; ")}`);
  }
  return missing.length === 0;
}

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
  /** This checkout against `baseline`, itself by default, under `overlay`; `install` as `compareTrees` takes it. */
  compare(
    overlay: Overlay,
    cases?: readonly Case[],
    baseline?: string,
    install?: Install | null,
  ): Promise<Comparison>;
}

/**
 * Registers the work directory's setup and removal; call at a test file's
 * top level. Each comparison's directory goes once it ends, while the next
 * test runs; the file's last hook waits for those removals and removes the
 * rest (row 011-179).
 */
export function comparisons(): Comparisons {
  let work: string | undefined;
  let release = "";
  let runs = 0;
  const removals: Promise<void>[] = [];
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "squeal-validity-"));
    release = lastRelease();
    extractTree(release, join(work, "release"));
  });
  afterAll(async () => {
    await Promise.all(removals);
    if (work !== undefined) await rm(work, { recursive: true, force: true });
  }, REMOVAL.timeout);
  const dir = () => {
    if (work === undefined) throw new Error("comparisons() runs its setup in beforeAll");
    return work;
  };
  return {
    release: () => release,
    tree: () => join(dir(), "release"),
    compare: async (overlay, cases = CASES, baseline = ROOT, install) => {
      const at = join(dir(), `run-${runs++}`);
      try {
        return await compareTrees({
          baseline,
          cases,
          overlay,
          work: at,
          ...(install === undefined ? {} : { install }),
        });
      } finally {
        const removal = rm(at, { recursive: true, force: true });
        // Raised by the file's last hook, which awaits it.
        removal.catch(() => undefined);
        removals.push(removal);
      }
    },
  };
}
