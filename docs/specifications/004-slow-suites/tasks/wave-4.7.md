# 004 wave 4.7: 004-33's interval re-listing on every pass

## 004-44 a file a rebuild adds joins the key on every interval pass (reviews/wave-4.6.md B1)

Outcome: a file that appears in an ignored declared directory joins the slow file's key at the next interval pass, whether or not that pass also found source changes.

Read: `reviews/wave-4.6.md` B1 and its probe (an ignored `dist/` addition plus unrelated source edits on successive interval passes leaves the key unchanged and the slow pass current; a quiet pass finds it).

Shape: repair. Test first: the review's probe fails at `9833c33` on Node 22 and 24, with its quiet-pass control. Seam: split the discovery out of `keys.lockfileCandidates()` (`src/core/scheduler/keying.ts:300,309`) into its own method, and in `reconcileBatch` (`src/core/scheduler/batch.ts:38`) stat the unwatched ignored declared inputs on every non-watch pass and diff them together with the batch's own candidates, keeping both sets of changes and cache updates (never replace one diff with the other). The installed-lockfile check stays on empty diffs, as today. These new candidates key slow results, not Vitest transforms: they must not feed 001-159's touch rule (`touchedUnchanged`; 001-168 is moving it to `src/core/scheduler/stability.ts`), so an unchanged rewrite of an ignored build never discards the Vitest instance. Test that too.

Owns: the discovery in `src/core/scheduler/keying.ts`, `reconcileBatch`'s candidate lines in `src/core/scheduler/batch.ts` (agreed with the 001 coordinator; send me the batch.ts diff before you finish), `test/scheduler/ignored-inputs.test.ts`. Leave alone: the rest of `batch.ts` and `stability.ts` (001-168), the watcher.

Done when: the probe and its control on both Nodes; an unchanged ignored rewrite is no touch; lint, typecheck, full suite on Node 24 and 22. Do not run `npm run build`; scratch in one `/tmp` directory of your own, removed; no CPU burners.

Use /worker.

## 004-45 re-review of 004-44

Outcome: `reviews/wave-4.7.md`: is `reviews/wave-4.6.md` B1 closed, and nothing around it broken (lockfile check, touch rule, source and artifact diffs merged). Range: `git log --oneline 9848df0..caec2ce` on main, 0.1.68: `c379e6d` (004-44), `8604813` (the slow-lane daemon test waits up to 20 s for the lowered priority) and the bundles; the `9848df0` 005 docs are out of scope. Second and last round for 004-33: a remaining blocker goes to the human. Rules as for 004-14.

Use /reviewer.
