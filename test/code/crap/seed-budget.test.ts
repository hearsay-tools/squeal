import { describe, expect, it } from "vitest";
import { SEED_FILES } from "../../../src/core/code/crap/index.js";
import { Seed } from "../../../src/core/code/crap/seed.js";
import { writeUncountable } from "../../../src/core/code/pass/failed.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import type { CodeFile } from "../../../src/core/types/code.js";
import { WT } from "../../state/helpers.js";
import { fakeCounter, pass } from "../pass/helpers.js";
import { COVERED, coverageRig } from "./rig.js";

/*
 * Row 015-48: the seed reads what it reads within the step's budget. The
 * counts of the functions an edit moved before the seed reached them are
 * read by its units, not as the edit is followed (review 0.1.311-r2 N1:
 * 1,007 reads in one call), and coverage's start checks for the first
 * count's end in its units, not in one read of every file (479 ms cold).
 */

const FILES = 2 * SEED_FILES;
const paths = Array.from({ length: FILES }, (_, f) => `src/m${f}.ts`);

/** `FILES` sources of one function each, counted, and a store that counts its count reads. */
async function counted() {
  const rig = coverageRig();
  await rig.edit(Object.fromEntries(paths.map((path, f) => [path, `old 3 b${f}\n`])));
  let reads = 0;
  const store: CodeStore = {
    ...rig.store,
    counts: {
      ...rig.store.counts,
      get: (...read) => {
        reads++;
        return rig.store.counts.get(...read);
      },
    },
  };
  const input = { store, worktreeId: WT, revision: rig.tree.source.latestRevision() };
  const countOf = (file: CodeFile) =>
    store.counts.get(file.blob, file.language, file.counterVersion);
  return { rig, store, input, countOf, reads: () => reads };
}

/** A budget of `units` units of work. */
const units = (n: number) => {
  let left = n;
  return () => left-- > 0;
};

const crap = (rig: ReturnType<typeof coverageRig>) =>
  rig.store.states
    .list(WT, { measure: "crap" })
    .map((s) => `${s.check.qualifiedName} ${s.outcome}`);

describe("the seed within the step's budget (row 015-48)", () => {
  it("reads an edit's moved functions in its units, in order, before it seeds a file", async () => {
    const { rig, input, countOf, reads } = await counted();
    const seed = new Seed(rig.store.files.list(WT), false);
    // Every file renames its function before the seed reaches it.
    for (const [f, path] of paths.entries()) rig.tree.write(path, `renamed 3 b${f}\n`);
    rig.tree.revise();
    const report = await pass(rig.tree, rig.store, fakeCounter(), { policy: COVERED });
    expect(report?.moves).toHaveLength(FILES);

    seed.follow(report ?? { moves: [], removed: [] });
    expect(reads()).toBe(0);
    expect(seed.advance(input, countOf, units(3))).toBe("more");
    expect(reads()).toBe(3);
    expect(crap(rig)).toEqual([]);

    expect(seed.advance(input, countOf, units(FILES - 3))).toBe("more");
    expect(crap(rig)).toEqual([]);
    expect(seed.advance(input, countOf, units(FILES))).toBe("done");
    expect(new Set(crap(rig))).toEqual(new Set(["renamed pending"]));
    expect(crap(rig)).toHaveLength(FILES);
  });

  it("waits at coverage's start for a file the first count has not counted, a unit at a time", async () => {
    const { rig, input, countOf } = await counted();
    const files = rig.store.files.list(WT);
    const late = files[SEED_FILES + 1];
    if (late === undefined) throw new Error("no file");
    // Its count failed once and is due again.
    rig.store.files.upsertMany(WT, [{ ...late, blob: "late" }]);
    const seed = new Seed(files, false, true);

    expect(seed.advance(input, countOf, units(Infinity))).toBe("uncounted");
    expect(crap(rig)).toHaveLength(SEED_FILES);
    expect(seed.advance(input, countOf, units(Infinity))).toBe("uncounted");

    rig.store.counts.put(
      { blob: "late", language: "typescript", counterVersion: 1, functions: [], errors: [] },
      1,
    );
    expect(seed.advance(input, countOf, units(Infinity))).toBe("done");
    expect(crap(rig)).toHaveLength(FILES - 1);
  });

  it("does not wait for a file the counter gave up on", async () => {
    const { rig, input, countOf } = await counted();
    const files = rig.store.files.list(WT);
    const late = files[SEED_FILES + 1];
    if (late === undefined) throw new Error("no file");
    rig.store.files.upsertMany(WT, [{ ...late, blob: "late" }]);
    const spent = { blob: "late", attempts: 3, retryAt: null, error: "out of memory" };
    writeUncountable(rig.store.meta, WT, new Map([[late.path, spent]]));

    expect(new Seed(files, false, true).advance(input, countOf, units(Infinity))).toBe("done");
    expect(crap(rig)).toHaveLength(FILES - 1);
  });
});
