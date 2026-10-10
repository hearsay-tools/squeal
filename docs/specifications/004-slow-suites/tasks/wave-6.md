# 004 wave 6: confirm the fixed loop, then ship

Decided by the human 2026-10-09 ("Confirm when calm"): once the host is quiet, a short confirmation dogfood of waves 5.5 and 5.6; spec 004 ships if it is clean. Dispatch only when the other coordinators' suites are not running and the load is below about 6 (24 CPUs).

## 004-53 confirmation dogfood: the revision loop stays closed in real use

Outcome: a `lessons.md` addendum, "Confirmation at 0.1.7x+", with a verdict and evidence per check. About 45 minutes; a check, not a third dogfood.

Read: `lessons.md` ("Re-dogfood at 0.1.68", defect 10 and its setup), spec 004 D2, D5, D6, `status.md`'s last six lines, `plugins/claude-code/README.md`.

Setup as in 004-46: this repository at `origin/main` (0.1.75 or later) in `/tmp/squeal-dogfood3-<yours>`, `npm ci`, `npm run build`; uncommitted config with `test/e2e/**` declared slow AND the original broad globs `test/fixtures/node-test/**` and `test/fixtures/vitest/**` restored (undoing `b70fcc2` there only). The shared store a pre-fix daemon wrote is the warm-store case 004-50 fixed; keep it. Sessions (dispatched before the dogfood model rule of 2026-10-09; future briefs use the board's Standing models): `claude --plugin-dir <worktree>/plugins/claude-code --model opus` with `squeal@hearsay` disabled in that session's `.claude/settings.local.json`. Never Fable; never read credentials; never edit `~/.claude` or `~/.codex`.

Check, with timestamps and daemon notes: (1, defect 10) after a session's edits and the node:test runs that write `.tmp`, the revision number settles; record it every minute for 10 idle minutes. (2) a `claude -p` session ending with slow files pending: the drain. (3) an idle slow tier's width and the line naming its running files. (4, defects 11, 12, 15) the line after a session ends, after a daemon restart, after a revert, against the truth.

Owns: `docs/specifications/004-slow-suites/lessons.md` (the addendum only), throwaway scripts under `research/probes/dogfood3/` with a README. No product code: name defects with reproductions. No CPU burners; stop every daemon you start; never kill what you did not start; remove the worktree.

Done when: each check has a verdict with evidence; the worktree is removed.

Use /worker.

## 004-52 a predecessor's saved closure does not re-add dropped scratch

Outcome: `reviews/wave-5.6.md` S1 closed: on a store a pre-004-50 daemon wrote, a saved combined closure in `test_files` no longer puts declaration-only scratch back into the extras and the watch set.

Read: `reviews/wave-5.6.md` S1, 004-50's commit `0aeff3b2` (`src/core/scheduler/keying.ts`, `src/core/keys/ignored-inputs.ts`, `src/core/keys/index.ts`), spec 004 D5 and D6. Shape: repair. Lead: where bootstrap reads stored closures back as extras in `keying.ts`, filter their paths through the same 004-47 rule 004-50 applies to the stat cache (an ignored path a declaration selects but the rule rejects, and no closure, environment, lockfile or observed read names, is dropped).

Owns: `src/core/scheduler/keying.ts`, `src/core/keys/ignored-inputs.ts`, `test/scheduler/scratch-inputs.test.ts`. Leave `bootstrap.ts` (004-54) and `src/core/state/**` (004-55) alone. Done when: a test with a complete predecessor store (hashes and saved closures) shows the dropped paths stay out of the watch set and no revision follows a full interval pass, red before the fix; lint, typecheck, full suite.

Use /worker.

## 004-54 a restarted daemon keeps the slow files' last durations across a key move (`lessons.md` defect 17)

Outcome: after a restart that follows an edit re-keying the slow files, before they run, the slow-tier line shows their last durations and the tier orders them shortest first.

Read: `lessons.md` defect 17 and `research/probes/dogfood3/logs/d2.kill-restart.txt`, spec 001 D5 (shortest first within a class), spec 004 D8. Shape: repair. Lead: `src/core/scheduler/bootstrap.ts`, the loop over `misses` reads a duration only under the file's stored previous key; when that key has no results, fall back to the file's newest results under any key, or the newest completed run of the file. Keep the `resultKey` line (001-170's held inherited fail) exactly as it is: only `durationMs` changes.

Owns: `src/core/scheduler/bootstrap.ts`, a new test file under `test/scheduler/`. Leave `keying.ts` (004-52) and `src/core/state/**` (004-55) alone; a store read you need beyond `src/core/store/repos/` existing methods: ask me first. Done when: a scheduler test (run, re-key, restart before the run) shows the durations kept and the order shortest first, red before the fix, plus the graceful-stop variant; lint, typecheck, full suite.

Use /worker.

## 004-55 "sources changed since" counts only paths in some slow file's sources (`lessons.md` defect 18)

Outcome: an edit to a fast test's fixture, a doc or any path in no slow file's key leaves the clause off; a change to a path some slow file's closure names turns it on.

Read: `lessons.md` defect 18, spec 004 D8, 004-48's commits (`git log --grep 004-48`), `src/core/state/slow.ts` (`sourcesChanged` and the `isSource` it is given). Shape: repair. Lead: build `isSource` from the slow files' stored closures (`src/core/store/repos/test-files.ts`) instead of `inheritsAcrossWorktrees`; keep the content comparison, the policy-file and artifact exclusions.

Owns: `src/core/state/slow.ts`, `test/status/slow-tier.test.ts`, `test/status/slow-tier-truth.test.ts`. Leave `src/core/scheduler/**` alone. Done when: a fixture-only edit and a docs edit leave the clause off, a source in a slow file's closure turns it on, the revert case stays as 004-48 made it; lint, typecheck, full suite.

Use /worker.

## 004-56 review of 004-52, 004-54 and 004-55

Outcome: `reviews/wave-6.md`, committed. Range: `git log --oneline 3040e11d^..17b0c227` on main, 0.1.88 (004-52, 004-54, 004-55, the D8 amendment and the bundles). The gate's load-sensitive failures at load 79 to 136 passed alone on both Nodes; 001-196 (0.1.87) underneath is out of scope. First round. Questions: does 004-52 drop only what 004-47's rule rejects, never a closure, environment, lockfile or observed path; can 004-54's fallback take a duration from a result that is not this file's, or change `resultKey`; does 004-55 keep the clause on for every path a slow file's key holds, including a declared artifact's sources outside `plugins/**`? Rules as for 004-14.

Use /reviewer.

## 004-57 "sources changed since" keeps executable sources a broad fast declaration selects (`reviews/wave-6.md` S1)

Outcome: a changed source behind an unchanged artifact turns the clause on even when some fast test declares it (`src/**/*.ts` in this repository), while a fixture-only or docs edit still leaves it off.

Read: `reviews/wave-6.md` S1 and its probe, `lessons.md` defect 18, spec 004 D8 (as amended for 004-55), `src/core/state/slow-sources.ts` (`artifactSources`, `listedClosures`). Shape: survey, then repair. The stored closure (`test_files.closure_paths`, `Closure.paths`) merges a file's resolved imports with its declared inputs, so no read can tell them apart for one file. Lead, no store change: subtract per file instead of globally. A path counts if some test file's stored closure names it and that file's own declared `inputs` do not select it (unit tests import `src` without declaring it; fixtures are named only by the tests that declare them); keep the test-file, slow-directory, policy-file and artifact exclusions and the content comparison. Measure the lead on this repository's real store (read-only) for `src/**`, `test/fixtures/**` and `docs/**` paths before committing to it. If it cannot separate them and only recording resolved paths apart would, stop and send me that design: the store, `storeClosures` and `src/core/keys` are the 001 lane's and sit under the key-format guard.

Owns: `src/core/state/slow-sources.ts`, `src/core/state/slow.ts`, `test/status/slow-tier.test.ts`, `test/status/slow-tier-truth.test.ts`. Do not edit `spec.md`; I amend D8 at integration. Done when: the review's overlapping-input case (a fast declaration `src/**/*.ts` and a changed source a closure names: clause on) and its fixture-only control (clause off) pass, red before the fix; 004-55's cases still pass; lint, typecheck, full suite.

Use /worker.

## 004-58 review of 004-57

Outcome: `reviews/wave-6.5.md`. Range: 004-57's commits and their bundle on main, pinned at landing. First round. Questions: does the clause now show for every source a slow file's artifact may be built from in this repository and in a dist-only end-to-end layout, and stay off for fixtures and docs; can any path a test loads be dropped because another file declares it? Rules as for 004-14.

Use /reviewer.
