import { describe, expect, it } from "vitest";
import {
  type KnownState,
  type ListingFact,
  listingMetaKey,
  type Policy,
  parseListing,
  refinedMetaKey,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Row 011-227 (011 C9 store-failures bullet as amended 2026-10-25, C4 step
 * 3; `research/fresh-start-counts.md` 4, option C): under `lookup-only` a
 * start commits its first lookup, with the listed counts, before it
 * re-resolves the closures of the misses whose closure came from the stored
 * list; the recheck commits again. The recheck cost 3.7 to 6.5 s before the
 * first listed header (011-223).
 *
 * Another branch resolved F0, F1, F3 and F4 last, with `SHARED`, which
 * their own closures do not import: the first lookup keys them from that
 * list and misses. The main checkout stored passes of F0, F1 and F2 and a
 * fail of F4 at the own closures' keys; a third worktree stored a fail of F1
 * at the shared list's key, which this worktree never confirmed. So the
 * recheck finds F0 and F1 current, F3 still a miss, F4 a held fail.
 */

const COUNT = 5;
const [F0, F1, F2, F3, F4] = [0, 1, 2, 3, 4].map(fileName) as [
  string,
  string,
  string,
  string,
  string,
];
const SHARED = "src/shared.ts";
const ref = (path: string): TestFileRef => ({ project: "", path });
const LOOKUP_ONLY: Pick<Policy, "baseline"> = { baseline: { onStart: "lookup-only" } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** `s`'s test state of `path`. */
const stateOf = (s: Side, path: string): KnownState | undefined =>
  s.store.knownStates
    .list(s.worktreeId)
    .find((state) => state.check.kind === "test" && state.check.testPath === path);

const ran = (s: Side) => s.runner.runs.flat().map((file) => file.path);
const listing = (s: Side): ListingFact | null =>
  parseListing(s.store.meta.get(listingMetaKey(s.worktreeId)));

/** What a start had committed when the recheck asked the runner for a closure. */
interface AtRecheck {
  readonly path: string;
  readonly listing: ListingFact | null;
  readonly refined: string | null;
  readonly rows: number;
  readonly f1Phase: string | null | undefined;
  readonly states: ReadonlyMap<string, Pick<KnownState, "outcome" | "validity"> | undefined>;
}

/** The repository with the main checkout's and the third worktree's results, and `b` unstarted. */
async function stored(policy: Pick<Policy, "baseline">) {
  const { main, others } = claimRepo(COUNT, { [SHARED]: "export const shared = 1;\n" }, 2);
  const [other, third] = others as [string, string];
  const a = side(main, { count: COUNT, policy: RUN_MISSING, rerunCap: 0 });
  a.runner.testFiles = async () => [F0, F1, F2, F4].map(ref);
  a.runner.failing.add(F4);
  await a.scheduler.start();
  await a.scheduler.idle();
  expect(ran(a).sort()).toEqual([F0, F1, F2, F4]);

  // Another branch resolved them last, with a module their own closures here do not import.
  const method = "static imports plus declared inputs" as const;
  for (const path of [F0, F1, F3, F4]) {
    const closure = { testFile: ref(path), paths: [SHARED, path], complete: false, method };
    a.store.testFiles.put({ testFile: ref(path), closure, updatedAt: Date.now(), updatedBy: "x" });
  }

  const c = side(third, { count: COUNT, policy: RUN_MISSING, rerunCap: 0 });
  c.runner.testFiles = async () => [ref(F1)];
  c.runner.closure = async (testFile) => ({ testFile, paths: [SHARED, testFile.path] });
  c.runner.failing.add(F1);
  await c.scheduler.start();
  await c.scheduler.idle();
  expect(stateOf(c, F1)).toMatchObject({ outcome: "fail", validity: "current" });

  const b = side(other, { count: COUNT, policy, rerunCap: 0 });
  b.runner.failing.add(F4);
  const recheck: AtRecheck[] = [];
  b.runner.closure = async (testFile) => {
    const states = new Map([F0, F1, F2, F3, F4].map((path) => [path, stateOf(b, path)]));
    recheck.push({
      path: testFile.path,
      listing: listing(b),
      refined: b.store.meta.get(refinedMetaKey(b.worktreeId)),
      rows: b.store.testFileKeys.list(b.worktreeId).length,
      f1Phase: b.phase(F1),
      states,
    });
    return { testFile, paths: [testFile.path] };
  };
  return { a, b, recheck };
}

describe(
  "under lookup-only a start commits its first lookup before the recheck (011-227)",
  SLOW,
  () => {
    it("commits the listed counts before the recheck's closures resolve", async () => {
      const { b, recheck } = await stored(LOOKUP_ONLY);
      await b.scheduler.start();

      expect(recheck.map((call) => call.path).sort()).toEqual([F0, F1, F3, F4]);
      for (const call of recheck) {
        expect(call.listing).not.toBeNull();
        expect(call.refined).toBe(String(call.listing?.revision));
        expect(call.rows).toBe(COUNT);
        // The first lookup's hit is current; the recheck's files are not yet.
        expect(call.states.get(F2)).toMatchObject({ outcome: "pass", validity: "current" });
        expect(call.states.get(F0)).toBeUndefined();
      }
    });

    it("after the second commit, counts, queue and held failures equal a single commit's", async () => {
      const { a, b } = await stored(LOOKUP_ONLY);
      await b.scheduler.start();
      await b.scheduler.idle();

      // Only the held fail ran, once, and confirmed; F3 stays a miss no policy queued.
      expect(ran(b)).toEqual([F4]);
      expect(b.passing()).toBe(3);
      for (const path of [F0, F1, F2]) {
        expect(stateOf(b, path)).toMatchObject({ outcome: "pass", validity: "current" });
        expect(b.keyOf(path)).toBe(a.keyOf(path));
      }
      expect(stateOf(b, F4)).toMatchObject({
        outcome: "fail",
        validity: "current",
        origin: { kind: "own" },
      });
      expect(stateOf(b, F3)).toBeUndefined();
      expect(b.phase(F3)).toBeNull();
      // One listing recorded, at the refined revision.
      const fact = listing(b);
      expect(fact?.count).toBe(1);
      expect(String(fact?.revision)).toBe(b.store.meta.get(refinedMetaKey(b.worktreeId)));
    });

    it("a file the recheck finds current is not queued and gets no failure notice", async () => {
      const { b, recheck } = await stored(LOOKUP_ONLY);
      await b.scheduler.start();
      await b.scheduler.idle();

      // F1's shared-list key holds another worktree's unconfirmed fail: held, never shown.
      expect(recheck.length).toBeGreaterThan(0);
      for (const call of recheck) {
        expect(call.f1Phase ?? null).toBeNull();
        expect(call.states.get(F1)).toBeUndefined();
      }
      expect(b.runner.ran(F1)).toBe(0);
      expect(stateOf(b, F1)).toMatchObject({ outcome: "pass", validity: "current" });
      const check = { kind: "test" as const, project: "", testPath: F1, fullName: "passes" };
      expect(b.store.transitions.history(b.worktreeId, check).map((t) => t.to)).not.toContain(
        "fail",
      );
    });

    it("a start under lookup-then-run-missing commits once, after the recheck", async () => {
      const { b, recheck } = await stored(RUN_MISSING);
      await b.scheduler.start();
      await b.scheduler.idle();

      expect(recheck.map((call) => call.path).sort()).toEqual([F0, F1, F3, F4]);
      for (const call of recheck) {
        expect(call.listing).toBeNull();
        expect(call.rows).toBe(0);
      }
      expect(ran(b).sort()).toEqual([F3, F4]);
      expect(b.passing()).toBe(4);
      expect(listing(b)?.count).toBe(1);
    });
  },
);
