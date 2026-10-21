# 011-63: a named wait holds for its matched files, worker notes (2026-10-21)

Brief W3 of `../wave-8.md`; research `../../research/issue-59.md`, `issue-65.md`, `issue-51.md` section 3; spec 011 C6 and C15, 005 D2. Base `f5ae85673`. Commits `4eee05d88` (code and tests) and `e0c4497f7` (every `commands.md` copy, `--help`).

## Seam map

- `src/cli/status-wait-paths.ts`: `decidedOutcome(selection, held, classes)` is the one outcome chain for a read whose selection is decided, used by `waitForNamed` and by the snapshot's `readOnce` (`status-paths.ts`). `unmatched` now means that no path selects a file. A mixed selection goes on to `slow`, `settled` or the poll, so its promotion is sent as before.
- `namedCode`: settled with a clean verdict and an unmatched path gives 3; a known failure among the matched files still gives 1; every other outcome gives 3, as before.
- `printNamed`: `{ ...snapshot, [wait|named]: payload, selection: payload }`. The same object goes under both keys.
- `status-wait-lines.ts` `namedLine`: `beside` adds `; no test file's closure holds <path>` after every outcome except `unmatched`. With no failure among the matched files, the unmatched text leads: `Named test files have no verdict: <unmatched>; the test files the other paths select at revision N: no known failures; ...`. With a failure: `Named test files at revision N: 1 known failure: ...; <unmatched>`.
- `waitForNamed` has `deadline = options.now() + timeoutMs`, a wall-clock time. The promotion's `withinMs` is `deadline - options.now()`, so the daemon's `until` (its own `Date.now()` plus `withinMs`, read later on the same host clock) is at least `deadline`. The last read passes `min(now, deadline - 1)` to `readNamedFiles`. `promotedIds` then still counts this wait's promotion at a timed-out read.

## Decisions the spec did not settle

1. **Exit and wording of a mixed selection.** The brief settles the exit (1 on a known failure, else 3). The clean case leads with "have no verdict" and the unmatched path, so the line agrees with exit 3. The evals parser (`evals/lib/squeal-text.mjs` `NAMED`) credits nothing for that line. A line that led with `Named test files at revision N: no known failures` would get credit and exit 3 at the same time.
2. **Startup gap.** If no path selects a file, the wait still returns `unmatched` at the first ready read. Issue-59's open question 1 (a worktree that lists none of the files at a read the wait thinks is ready) is not handled.
3. **The JSON payload under `selection`** is the whole `NamedWaitPayload` (`outcome`, `waitedMs`, `code`, `testFiles`, `unmatched`, `leftForPause`, `verdict`), not only `testFiles`. `outcome` tells the two forms apart. No `schemaVersion` raise: the field is additive.
4. **The label at the deadline: the last read judges every file at the deadline.** The whole `readNamedFiles` call runs at `min(now, deadline - 1)`, not only its promotion check, because `standing.ts` (W2's file) takes one `now`. The other uses of that `now` are a claimant's heartbeat freshness and the claim bound, `now + C7's bound`. They move earlier by the lateness of the last read, a few milliseconds, and the bound prints to the second. If 011-58 adds a separate time for the promotion check to `standingsOf`, the call can pass it and keep `now` for the rest. `promotions.ts` is unchanged.
5. **Rewrite race.** The daemon rewrites the `promotions` row only on a change: a queue `add` or `promote`, which drops expired entries. If such a change falls between the deadline and the last read, a few milliseconds, the label is lost again. No queue change happens while a wait only waits behind a running tier, which is #51's case.
6. **Spec text to amend (coordinator's).** 005 D2: "A path that selects nothing exits 3 with ..." covers only the case where no path selects a file. A mixed selection waits, promotes and names the path beside the verdict. 011 C15, "the CLI says promoted only while ... the deadline has not passed": a wait's last read judges this as of its deadline. 011 C15 "Lifetime": the request carries the time left on the store's wall clock. 011 C6 or C15: the `selection` field of both JSON forms.

## Facts found on the way

- The four bundle tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`) fail on `cli/squeal.mjs differs from the build`, because `src/cli/` changed and the bundles are not this row's.
- `status-wait-lines.ts` was 420 lines before this row and is 436 now. The named-wait half (`namedLine`, `pauseText`, `selectedLine`, `namedText`, `namedClassLines`, `unsyncedText`) could move to its own file. Tests import those names from `status-wait-lines.js`.
- Red before: every new test in `test/cli/status-wait-mixed.test.ts` and the new deadline test in `status-wait-promoted.test.ts` failed on the base (`unmatched` where `settled` or `timeout` was expected, no `selection` key, `queued` without `promoted`).
