import { describe, expect, it } from "vitest";
import { formatWhy, readWhy, WHY_CHANGED_LIMIT } from "../../src/core/status/index.js";
import type { Store } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";
import { reportOf } from "./why-seed.js";

const LOGIN = check("src/auth.test.ts", "auth > login");
const NAME = "src/auth.test.ts > auth > login";

/** Appends one revision per entry, each changing the paths listed. */
function revisions(store: Store, worktreeId: string, changes: readonly (readonly string[])[]) {
  for (const paths of changes) {
    store.revisions.append({
      worktreeId,
      createdAt: 1,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: paths.map((path) => ({ path, oldHash: "h0", newHash: "h1" })),
    });
  }
}

/** The main worktree with `auth > login` observed at `observedAt`, after `changes` made its revisions. */
function seed(observedAt: number, changes: readonly (readonly string[])[]) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  revisions(store, repo.mainId, changes);
  store.knownStates.upsertMany([state(repo.mainId, LOGIN, { outcome: "fail", observedAt })]);
  return repo;
}

/*
 * Task 001-225 (005 D6): when the shown result was observed at a revision
 * older than the current one, `why` names each path changed since and the
 * revisions that changed it.
 */
describe("squeal why, changed since an older revision", () => {
  it("lists each path changed after the result's revision with its revisions", () => {
    const repo = seed(8, [
      ...Array.from({ length: 8 }, () => ["src/old.ts"]),
      ["src/a.ts"],
      ["src/b.ts"],
      ["src/c.ts", "src/a.ts"],
      ["src/b.ts"],
    ]);

    const why = reportOf(readWhy(repo.main, NAME));

    expect(why.revision).toBe(12);
    expect(why.changedSince).toEqual({
      revision: 8,
      total: 3,
      paths: [
        { path: "src/a.ts", revisions: [9, 11], revisionCount: 2 },
        { path: "src/b.ts", revisions: [10, 12], revisionCount: 2 },
        { path: "src/c.ts", revisions: [11], revisionCount: 1 },
      ],
    });
    expect(formatWhy(why)).toContain(
      [
        "Known state: FAIL, current, observed at revision 8",
        "  Changed since revision 8: src/a.ts (revisions 9, 11), src/b.ts (revisions 10, 12), src/c.ts (revision 11)",
        "",
      ].join("\n"),
    );
  });

  it("is absent for a result observed at the current revision", () => {
    const repo = seed(3, [["src/a.ts"], ["src/b.ts"], ["src/a.ts"]]);

    const why = reportOf(readWhy(repo.main, NAME));

    expect(why.revision).toBe(3);
    expect(why.changedSince).toBeUndefined();
    expect(formatWhy(why)).not.toContain("Changed since");
  });

  it("caps the paths and each path's revisions like the other why lists", () => {
    const many = Array.from({ length: WHY_CHANGED_LIMIT + 5 }, (_, i) => `src/f${i}.ts`);
    const repeated = Array.from({ length: WHY_CHANGED_LIMIT + 2 }, () => ["src/f0.ts"]);
    const repo = seed(1, [["src/first.ts"], many, ...repeated]);

    const why = reportOf(readWhy(repo.main, NAME));

    const since = why.changedSince;
    expect(since?.total).toBe(WHY_CHANGED_LIMIT + 5);
    expect(since?.paths).toHaveLength(WHY_CHANGED_LIMIT);
    expect(since?.paths[0]).toMatchObject({
      path: "src/f0.ts",
      revisionCount: WHY_CHANGED_LIMIT + 3,
    });
    expect(since?.paths[0]?.revisions).toHaveLength(WHY_CHANGED_LIMIT);
    const line = formatWhy(why)
      .split("\n")
      .find((l) => l.includes("Changed since"));
    expect(line).toMatch(/^ {2}Changed since revision 1 \(first 20 of 25 paths\): src\/f0\.ts \(/);
    expect(line).toContain(`, 21 (first 20 of ${WHY_CHANGED_LIMIT + 3} revisions)), src/f1.ts`);
  });
});
