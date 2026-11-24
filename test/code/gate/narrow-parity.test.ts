import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storedDurations } from "../../../src/cli/code-gate-durations.js";
import { narrowRun, type StoredObserved } from "../../../src/core/code/gate/narrow.js";
import { ObservedSets } from "../../../src/core/keys/observed.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { SchedulerContext } from "../../../src/core/scheduler/context.js";
import { editWork, fetchEditCut, observedDirectOf } from "../../../src/core/scheduler/edit-cut.js";
import { Ledger } from "../../../src/core/scheduler/ledger.js";
import type { RunnerPartBound } from "../../../src/core/scheduler/runner-work-bound.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { AffectedTestFiles } from "../../../src/core/types/runner.js";
import { repo } from "../../cli/code-gate-fixture.js";

/*
 * Row 026-21 (spec 026 D5.2): `squeal code --base --narrow` keeps exactly
 * the files `squeal run <group> --base` keeps for one diff. The daemon side
 * is `selectNarrow`'s steps (row 019-49) over `editWork`; the gate side is
 * `narrowRun`, with the stored direct marks and run reads read back from a
 * real store through `storedDurations`, as `squeal code` reads them.
 */

const A = "src/a.ts" as RelativePath;
const X = "src/x.ts" as RelativePath;
const K = "test/k.test.ts" as RelativePath;

interface Fixture {
  readonly ms: number | null;
  /** Sources the file imports directly, and through other modules. */
  readonly direct?: readonly RelativePath[];
  readonly transitive?: readonly RelativePath[];
  /** Stored direct marks (016 D4) and run reads (001 D3). */
  readonly marks?: readonly RelativePath[];
  readonly reads?: readonly RelativePath[];
}

/** A namesake, importers, readers and a no-namesake source, across two groups. */
const FILES: Readonly<Record<string, Fixture>> = {
  "test/a.test.ts": { ms: 4_000, direct: [A] },
  "test/b.test.ts": { ms: 3_000, direct: [A] },
  "test/c.test.ts": { ms: 1_000, direct: [A] },
  "test/d.test.ts": { ms: 500, transitive: [A] },
  "test/e.test.ts": { ms: 2_000, marks: [A] },
  "test/f.test.ts": { ms: 200, reads: [A] },
  "test/g.test.ts": { ms: null, direct: [A] },
  "test/j.test.ts": { ms: 300, direct: [X] },
  "test/k.test.ts": { ms: 100 },
  "test/m.test.ts": { ms: 100, direct: ["src/other.ts" as RelativePath] },
  "test/browser/h.test.ts": { ms: 100, direct: [A, X] },
  "test/browser/i.test.ts": { ms: 50, transitive: [A] },
};
const CHANGED = [A, X, K];
const ref = (path: string): TestFileRef => ({ project: "", path: path as RelativePath });
const LISTED = Object.keys(FILES).map(ref);
const groupOf = (r: TestFileRef) => (r.path.startsWith("test/browser/") ? "browser" : "unit");
const fixtureOf = (r: TestFileRef): Fixture => FILES[r.path] ?? { ms: null };

function affected(changed: readonly RelativePath[]): AffectedTestFiles {
  const holding = (key: "direct" | "transitive") =>
    LISTED.filter((r) => fixtureOf(r)[key]?.some((p) => changed.includes(p)));
  return { direct: holding("direct"), transitive: holding("transitive") } as AffectedTestFiles;
}

/** The daemon's keys over `FILES`: a closure holds every path the file imports, marks or reads. */
function keysOver(observed: StoredObserved) {
  const closure = (r: TestFileRef) => {
    const f = fixtureOf(r);
    return [...(f.direct ?? []), ...(f.transitive ?? []), ...(f.marks ?? []), ...(f.reads ?? [])];
  };
  const referencing = (paths: Iterable<RelativePath>) => {
    const set = new Set(paths);
    return LISTED.filter((r) => closure(r).some((p) => set.has(p)));
  };
  return {
    index: { reverse: { referencing } },
    declaredFor: () => [],
    observedOf: (r: TestFileRef) => observed.readsOf(r),
    directOf: (r: TestFileRef) => observed.directOf(r),
  };
}

/** `squeal run <group> --base`'s selection of `CHANGED` in `group` (`selectNarrow`, row 019-49). */
async function daemonKept(tierSize: number, observed: StoredObserved): Promise<string[]> {
  const keys = keysOver(observed);
  const context = { keys, policy: { runner: { tierSize } } } as unknown as SchedulerContext;
  const files = new Map(
    LISTED.map((r) => [testFileId(r), { id: testFileId(r), ref: r, durationMs: fixtureOf(r).ms }]),
  );
  const fake = { context, files };
  const ledger = Object.assign(fake, {
    recentOf: (changed: ReadonlySet<RelativePath>, direct?: ReadonlySet<string>) =>
      Ledger.prototype.recentOf.call(fake as unknown as Ledger, changed, direct),
  }) as unknown as Ledger;
  const kept = new Set<string>();
  for (const path of CHANGED) {
    const own = LISTED.filter((r) => r.path === path);
    if (own.length > 0) {
      for (const r of own) kept.add(testFileId(r));
      continue;
    }
    const answer = affected([path]);
    const direct = new Set(answer.direct.map(testFileId));
    const observedDirect = observedDirectOf(keys, [path], direct);
    const bound = {} as RunnerPartBound;
    const cut = await fetchEditCut(context, LISTED, [path], answer, bound);
    const changed = new Set([path]);
    for (const group of ["unit", "browser"]) {
      const within = (id: string) => groupOf(files.get(id)?.ref ?? ref("")) === group;
      const work = editWork(context, ledger, cut, changed, direct, observedDirect, within);
      for (const id of work.kept) kept.add(id);
    }
  }
  return LISTED.filter((r) => kept.has(testFileId(r))).map((r) => r.path);
}

/** `squeal code --base --narrow`'s selection of `CHANGED` among `run`. */
async function gateKept(tierSize: number, observed: StoredObserved | undefined, run = LISTED) {
  const { kept } = await narrowRun({
    adapter: { affected: async (paths) => affected(paths) },
    listed: LISTED,
    run,
    paths: CHANGED,
    tests: [],
    tierSize,
    durations: (r) => (fixtureOf(r).ms === null ? null : (fixtureOf(r).ms ?? 0) / 1000),
    observed,
    groupOf,
  });
  return kept.map((r) => r.path);
}

/** A repository whose main store holds `FILES`' marks and reads, read back as `squeal code` reads it. */
function storedObserved(): { observed: StoredObserved; close(): void } {
  const root = repo() as AbsolutePath;
  const store = openStore(join(root, ".git") as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  const sets = new ObservedSets(store);
  for (const r of LISTED) {
    sets.mark(r, fixtureOf(r).marks ?? []);
    sets.see(r, fixtureOf(r).reads ?? []);
  }
  sets.write();
  store.close();
  const durations = storedDurations(root);
  if (durations === null) throw new Error("no store");
  return { observed: durations.observed, close: () => durations.close() };
}

describe("code --narrow and run --base keep the same files (row 026-21, spec 026 D5.2)", () => {
  it("keeps the namesake, the shortest importers with stored marks, then readers, per group", async () => {
    const stored = storedObserved();
    try {
      expect(await gateKept(3, stored.observed)).toEqual([
        "test/a.test.ts",
        "test/b.test.ts",
        "test/c.test.ts",
        "test/e.test.ts",
        "test/j.test.ts",
        "test/k.test.ts",
        "test/browser/h.test.ts",
        "test/browser/i.test.ts",
      ]);
      expect(await daemonKept(3, stored.observed)).toEqual(await gateKept(3, stored.observed));
    } finally {
      stored.close();
    }
  });

  it("matches at every tierSize, over every listed file and over the closure's selection", async () => {
    const stored = storedObserved();
    try {
      const reached = new Set([...CHANGED, ...affectedPaths(), "test/e.test.ts", "test/f.test.ts"]);
      const closure = LISTED.filter((r) => reached.has(r.path));
      for (const tierSize of [0, 1, 2, 4, 5, 6, 10]) {
        const daemon = await daemonKept(tierSize, stored.observed);
        expect(await gateKept(tierSize, stored.observed), `tierSize ${tierSize}`).toEqual(daemon);
        expect(await gateKept(tierSize, stored.observed, closure)).toEqual(daemon);
      }
    } finally {
      stored.close();
    }
  });

  it("without the stores, misses the file only a stored mark reaches", async () => {
    const kept = await gateKept(3, undefined);
    expect(kept).not.toContain("test/e.test.ts");
    expect(kept).toContain("test/g.test.ts");
  });
});

function affectedPaths(): string[] {
  const { direct, transitive } = affected(CHANGED);
  return [...direct, ...transitive].map((r) => r.path);
}
