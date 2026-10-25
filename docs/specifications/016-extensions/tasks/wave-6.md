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

## Review of the wave 6 candidate (016-29, 016-30)

Use /reviewer. The candidate branch and SHA are named in the spawn. The range is `origin/main..<SHA>`: five commits of worker 00f19154 (016-30's removals, the failing test, the view, slice 1, notes), the coordinator's 011 C3 sentence and status lines, the version raise and the bundle commit. Write `docs/specifications/016-extensions/reviews/<version>.md` and commit it alone on your branch.

Read: the brief above; `tasks/016-29/notes.md`; `quality/2026-10-25.md` (row 016-29, drop candidates 1 and 2); 011 C3 (the observed-paths sentence) and 011 `status.md`'s line of 2026-10-25 for 016-29.

Check, with proof where you can:
1. The new test in `one-write-path.test.ts` fails on `origin/main` and passes here. After the rollback and after the next record it asserts that no stored result's key reads an observed path the store lacks (011's addition a). A restart between the rollback and the next record rebuilds the view from the store, and the file runs again (011's addition b).
2. Two daemons in two worktrees writing one meta key keep the union, for all three keys (the two-connection test). `write` reads the stored text inside its transaction, never from a cache.
3. Stored bytes are unchanged: compare-refs at `squeal--v0.1.320` equal for every case, uncovered 0, `KEY_FORMAT_VERSION` at 20. Say why the run counts 64 cases where 0.1.316's counted 103 (`status.md`, 016-24's line), and whether any case is missing.
4. The notes' residue: after its own write, a view's next read merges other worktrees' paths without reporting them as grown. Say whether a file can then stay current at a key that lacks those paths.
5. 016-30: each removed case is proven by kit K5 on node:test and by the named remaining cases, as the scan states.
6. `SharedPaths.write` runs once per record transaction in product code; a second call in one transaction is not reachable.

Run lint, typecheck, `test/scheduler/one-write-path.test.ts`, `test/keys/observed.test.ts`, `test/keys/key-format.test.ts` and `test/kit/*.test.ts` on Node 22 and Node 24, and the locked full suite: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
