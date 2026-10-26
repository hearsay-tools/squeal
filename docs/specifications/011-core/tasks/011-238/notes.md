# 011-238: notes

## Slices 3 to 5 (wave 50 W2)

Brief: `tasks/wave-50.md` W2, baseline `00daa15e5`. Source: `quality/2026-10-26-a.md` slices 3, 4 and 5. Each slice is a rename or a move with no change in behaviour: no line, header, JSON field or key changes.

### Slice 3: the change feed's last delivered pass is `deliveredPass`

Cause: "delivered" named two things in the change feed. `ChangeFeed.delivered`, `Feed.delivered` and `FeedPasses.delivered()` were the last delivered pass (row 011-198). `onDelivered`, `FeedDeliveredRow` and the `feed-delivered:` row (row 011-200) are every delivered batch.

Change: the first group is now `deliveredPass`, in `src/core/types/watcher.ts` (`FeedPasses.deliveredPass()`), `src/core/watcher/change-feed.ts` (`ChangeFeed.deliveredPass`, `Feed.deliveredPass`, and the two comments that named the field), and the two readers, `src/core/daemon-loop/index.ts` and `src/core/scheduler/scheduler.ts` (`requestFullSuite`). No test read the field or built a `FeedPasses` by hand: `grep` found none, and typecheck passed with no test edit. The `onDelivered` group keeps its name.

### Slice 4: one status function applies the three liveness decorators

Cause: `readLiveHeader` (`src/core/delivery/liveness.ts`) and the status snapshot (`src/core/status/snapshot.ts`) each nested `withLate(withStopping(withDeath(…)))` over their own base. Row 011-200 had to add `withLate` to both.

Change: `withDaemonFacts(store, worktree, base, now)` in the new `src/core/status/daemon-facts.ts` (21 lines) applies the three in the same order. Both callers pass their own base: delivery's is `asRested(asStopped(worktreeLiveness(…)))`, so `asRested` stays inside it; the snapshot's is `asStopped(liveness(…))`. `livenessChange` (`delivery/liveness.ts`) is unchanged: it still applies `withStopping` alone. A new file, because `snapshot.ts` is 405 lines before this change (394 after).

### Slice 5: `stillClock` is gone

Cause: `stillClock` (`test/scheduler/tier-yields-named.test.ts`, row 011-184) was `ModelClock`'s `now` and `cross` (`test/scheduler/model-clock.ts`, row 011-195) without its timers. Its comment named an `advance` it did not have; the advance is the side's (`catchUpSide`'s `movableClock`).

Change: tests 9, 10 and 11 give the scheduler `new ModelClock().now`, with `install()` never called, so the timers stay the host's. Both clocks jump once, `ms` ahead, at the reading after `reads` more readings, so the crossings of tests 10 and 11 come at the same reading. One difference, with no effect on the tests: `ModelClock` takes the host's time at its first reading, `stillClock` at its creation. The file's header comment now says what the clock is.

### Evidence

Lint (`npm run lint`): `Checked 2235 files in 678ms. No fixes applied.` Typecheck (`npm run typecheck`, `tsc --noEmit`): no output, exit 0.

Squeal 0.1.334, revision 9 (the three commits): `all 1158 test files current`, `10284 passed (9126 tests, 1158 test files loaded)`, 16 skipped, 4 known failures. The edits re-keyed 511 test files; all ran at revision 9. The four failures are the bundle checks (`test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`): `cli/ps.mjs differs from the build`. That is the expected drift: the committed bundles still hold `passes.delivered()` and `feed?.delivered` (`plugins/claude-code/dist/cli/squeal.mjs`), and this row does not rebuild them. They pass once the coordinator's bundle commit rebuilds.

With paths, 0.1.334 first selected the readers (471 test files for `src/core/types/watcher.ts`), and later answered "no test file's closure holds" each source path: row 011-233's gap. So the 34 test files that import a changed module directly (a fixture and an e2e file left out), with `test/keys/key-format.test.ts`, `test/delivery/liveness.test.ts` and `test/status/feed-late.test.ts`, were named as test files: `no known failures; 37 test files, each with a current result`. `test/e2e/torn-status.test.ts` imports `daemon-loop/index.ts`; Squeal does not run `test/e2e/**`, and it was not run here.

### Commits

- `278952faa` refactor(011-238): slice 3: the change feed's last delivered pass is deliveredPass
- `ff8090498` refactor(011-238): slice 4: one status function applies the three liveness decorators
- `256d7eb7a` test(011-238): slice 5: tier-yields-named uses ModelClock, not installed; stillClock gone

### Seen, not changed

- `liveness` in `src/core/status/snapshot.ts` (the private function under `snapshot`) restates `daemonLiveness` in `src/core/delivery/liveness.ts`: the same grace rule and the same three results. `delivery/liveness.ts` already imports `HEARTBEAT_GRACE_INTERVALS` from the snapshot, so the snapshot could call `daemonLiveness` if it moved to `src/core/status/`. Not in this row's slices; a later quality scan can weigh it.
- `docs/specifications/011-core/tasks/011-184/notes.md` still names `stillClock`. It is that row's record of its time and is left as it is.
