# 004 wave 5.5: from the re-dogfood

## 004-47 ignored files enter only a slow file's declared artifact, so no run feeds its own inputs

Outcome: a test that writes scratch files into a gitignored directory its declared inputs cover (this repository: node:test tests write `test/fixtures/node-test/.tmp`, declared as `test/fixtures/node-test/**`) settles: its run is stored, no revision loop follows, and a daemon whose last session ended drains and exits.

Read: `lessons.md` "Re-dogfood at 0.1.68", defect 10 (the loop: r2 to r51 in 20 min, each revision only `.tmp/<uuid>/` adds and deletes; `.tmp/` gitignored under the declared inputs of `test/runners/node-test/**/*.test.ts` and `test/integration/node-test.test.ts`); spec 004 D5 ("for slow files must name the artifact it tests") and D6 (an artifact is a file neither a test file nor under a directory a slow glob covers); `src/core/scheduler/keying.ts` (`ignoredCandidates`, `track(ignoredInputs(…, inputGlobs(this.#policy.inputs)))`: today every declared input, fast or slow, lists ignored files); the 001 coordinator's note: 001-168's completion barrier re-stats every input a tier's keys name, so a path written during the run withholds it; it needs no change once those paths are not inputs.

Shape: repair. Test first: (1) a fast node:test (or Vitest) file whose declared inputs cover a gitignored scratch directory it writes into during its run: its result is stored, the scheduler goes idle, no further revision appears within two interval passes (the 001 coordinator's guard); (2) the re-dogfood's loop as reported, if it reproduces as a scheduler test. Seam: list ignored files only for the declared inputs of entries whose test-file glob selects at least one slow file (D5's artifact), and drop any listed path that is a test file or lies under a directory a slow glob covers (D6's rule, `inheritsAcrossWorktrees`'s predicate). Tracked files under declared globs stay inputs as before. Keep 004-28/38/41/44's tests passing.

Owns: `src/core/scheduler/keying.ts` (the ignored-input listing), `src/core/keys/ignored-inputs.ts`, their tests. Leave alone: `src/core/scheduler/batch.ts` and the 001 lane's stability and ledger code. Do not run `npm run build`; scratch in one `/tmp` directory of your own, removed; no CPU burners.

Done when: both tests on Node 22 and 24; existing ignored-input tests pass; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 004-48 the slow-tier line after a session ends, after a restart, and after a revert (defects 11, 12, 15)

Outcome: the line never says "waiting for the agent to pause" when no consumer is in a turn, never shows a dead daemon's slow file as running, and says "sources changed since" only when a source's bytes differ from the tested revision's.

Read: `lessons.md` "Re-dogfood at 0.1.68", defects 11, 12 and 15 with their timestamps; spec 004 D8; 004-23's validation of a running activity (`src/core/state/slow.ts`).

Shape: repair. Test first, one per case: (11) the published `waiting: idle` with no consumer registered, or none in a turn, is rendered as what the tier actually waits for (fast work, or nothing), never "the agent to pause"; (12) a running activity published by a daemon that is not the live one (the `slow-tier:<worktree>` row outlives its daemon) is not shown as running: carry the publishing daemon's identity in the activity and compare it with the live daemon's, or drop it at the successor's start; (15) "sources changed since" compares each candidate source's current hash with its hash at the tested revision, so a revert to the same bytes reads no change, and Squeal's own `squeal.config.json` is never a source of the artifact.

Owns: `src/core/state/slow.ts`, `src/core/state/slow-text.ts`, `src/core/slow/state.ts`, the publish lines in `src/core/scheduler/slow-tier.ts` (if 12 needs the daemon's identity there), `src/core/types/status.ts` (additive), their tests. Leave alone: `src/core/scheduler/keying.ts` and `src/core/keys/**` (004-47), the 001 lane's code. Do not run `npm run build`; scratch in one `/tmp` directory of your own, removed; no CPU burners.

Done when: the three tests on Node 22 and 24; the existing slow-tier line tests pass; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 004-49 review of wave 5.5

Outcome: `reviews/wave-5.5.md`: 004-47 and 004-48, first round; also that this repository's own node:test fixture writes no longer loop. Range pinned at dispatch. Rules as for 004-14.

Use /reviewer.
