# 004 wave 5.6: 004-47 on a store a pre-fix daemon wrote

## 004-50 cached ignored scratch never becomes a declared input after an upgrade (reviews/wave-5.5.md B1)

Outcome: a worktree whose store was written by a daemon from 0.1.60 to 0.1.73 (which cached ignored scratch under fast entries' declared globs) settles as a fresh one does: no cached ignored path enters a declared input unless it is a slow file's declared artifact now.

Read: `reviews/wave-5.5.md` B1, its three-step warm-store probe and its "fix sized for one keying worker"; `src/core/scheduler/keying.ts` `bootstrap` (every cached ignored path goes to `#extra`, and `#knownFiles()` hands them to `createDeclaredInputs`) and `#ignoredArtifacts` (004-47's rule).

Shape: repair. Test first: the review's probe (pre-fix bootstrap seeds `fixtures/.tmp/out.txt` through the real `fileHashes`; the candidate then starts on the same store) on Node 22 and 24, with a repeatedly rewritten existing scratch file, and its cold control. Seam: apply 004-47's eligibility (a slow entry's declared artifact, not a test file, not under a slow glob's directory) when declared inputs are assembled from cached and extra paths, not only when new ignored files are listed; drop declaration-only ignored entries from the extra-watch set at bootstrap, keeping ignored paths a static or observed closure, an environment or an installed dependency still needs. Do not disable 001-168's completion barrier, and do not discard every ignored cache entry.

Owns: `src/core/scheduler/keying.ts` (declared-input assembly, bootstrap's ignored extras), `src/core/keys/ignored-inputs.ts`, `test/scheduler/scratch-inputs.test.ts` and its neighbours. Leave alone: the 001 lane's stability, ledger and watcher code; `batch.ts`. Do not run `npm run build`; scratch in one `/tmp` directory of your own, removed; no CPU burners.

Done when: the warm-store case and its control on both Nodes; 004-47's and 004-28/38/41/44's tests pass; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 004-51 re-review of 004-50

Outcome: `reviews/wave-5.6.md`: is `reviews/wave-5.5.md` B1 closed on a warm store, and nothing around it broken (closure and environment extras kept, artifacts still keyed). Range pinned at dispatch. Second and last round for 004-47's slice: a remaining blocker goes to the human. Rules as for 004-14.

Use /reviewer.
