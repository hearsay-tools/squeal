# Wave 6: one owner for the shared observed sets, and two kit-proven cases out

One worker, rows 016-29 and 016-30, from the quality scan `quality/2026-10-25.md`. Spec 016 shipped at 0.1.320; these are follow-ups. Workers do not run `npm run build`.

## 016-29 and 016-30

Use /worker. Shape: repair. Outcome: one view class owns the three shared observed sets (`observed.`, `observedDirect.`, `observedStartup.<project>`) and writes them in the record's transaction, so a path a rolled-back record lost is stored by the next record; and the two node:test adapter cases the kit already proves are gone.

Read: the board rows 016-29 and 016-30; `quality/2026-10-25.md` (row 016-29, slices 1 and 2, drop candidates 1 and 2); `spec.md` D4; 011 C3 (the observed-paths sentence, "written in one transaction that merges and never prunes").

Starting seam: `ObservedSets.add` in `src/core/keys/observed.ts`, against `WorktreeKeys.writeSeen` in `src/core/scheduler/keying.ts`. First edit, as a lead: a test in `test/scheduler/one-write-path.test.ts`, shaped like its case at line 140, that throws in `meta.set` for `observedMetaKey` during a record, then asserts that the next record stores the path. First step: send me a request with that test's result on main and your design (the view's shape over both stored forms, and whether any stored byte or key changes) before you build past the test.

Owns: `src/core/keys/{observed,startup,index}.ts` and a new `src/core/keys/listings.ts`; in `src/core/scheduler/keying.ts` and `record-tier.ts` only the observed-set calls; `test/keys/observed.test.ts`; `test/scheduler/one-write-path.test.ts`; the `writeSeen` call in `test/kit/worktrees.ts`; `test/runners/node-test/adapter-preload-require.test.ts` and `adapter-preload-quoted.test.ts`.

Leave alone: `src/runners/**`; the validity harness; other scheduler files; spec text (the coordinator's, with 011).

Commits, in order: 016-30's two removals; the failing test; the view; slice 1 (`Listings` takes a required root); slice 2 (`Listings` and its markers move to `listings.ts`).

Done when:
- the new test fails on main and passes;
- the observed, start-up, direct, ignored, pytest and kit tests named in row 016-29 pass with no assertion changed;
- `test/keys/key-format.test.ts` passes with no version raised;
- `src/core/keys/` holds one merge and one parse of these maps;
- `squeal run --all --wait` is green.
