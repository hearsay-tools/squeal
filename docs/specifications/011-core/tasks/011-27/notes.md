# 011-27 notes: every file without a verdict names what advances it

Worker notes for board row 011-27 (011-24 R2; gh-38, gh-39, gh-40, gh-41, gh-43, gh-46's hint). Brief: the `## 011-27` section of `../011-24/briefs.md`; design `../011-24/design.md` sections 3 and 5 R2; spec 011 C5 and C15 as amended 2026-10-20. Baseline `b46dd13a` (0.1.228, after 011-42's 0.1.227 reshaping of the waits).

## Probe: does the store keep each project's global setup files?

No. The Vitest adapter lists a project's `setupFiles` and `globalSetup` closures among its environment `files` (`src/runners/vitest/environment.ts:36-45`), and `canonicalConfig` puts the resolved `globalSetup` entries into `resolvedConfig` (`:84-92`). The core only hashes both into the environment hash (`src/core/keys/environment.ts:60-75`), which every key of the project carries. No table keeps the list: `test_files.closure_paths` holds a test file's own closure, and no `meta` row records a project's environment inputs.

The one place a global setup file reaches the store is the setup check of 001-382: a `known_states` row with `check.kind === "setup"` and `testPath` the setup file, written when a run of the project failed to start in this worktree, and kept, `pass`, once a later run gets past it. So, by the design's fallback:

- the gh-46 clause names the file when that setup check exists in this worktree (`setupsOf`, `src/cli/named-standing.ts`);
- otherwise it is left out. The design's middle case, "names no file when the adapter recorded that the project has one", does not arise: the adapter records nothing the CLI can read;
- the one-file `retry --reason environment` hint stays on every running slow file, as the design says.

Naming the file always would take a per-project `meta` row of global setup files written where the environment is computed: a scheduler change, guarded, not done here.

## What changed

- `src/core/status/next-step.ts` (new, pure): `nextStep(standing, { named })` maps one `Standing`, a state from section 3's table, to the class line's reason, the verdict line's shorter one and a `Step`: `retry` (with the load note, the one-file `--reason environment` form, and the count `run --all --wait` runs), a Squeal `command`, a `shell` command (`npm ci`), or `none` with why. `src/core/status/next-step-text.ts` renders a step for a group's paths: up to three paths in the command, above that `<test file>...` and `squeal run --all --wait runs all N test files not current here` (Q5).
- `src/cli/named-files.ts`: each selected file without a current result gets `standing`. Stale and unknown files test another live worktree's claim on their key first (the order rule), then their own state. `PendingReason` is now `Extract<Standing, ...>`: `running` gains `files` (its open run's count) and `setup` (a slow file's known global setup), and `queued` gains `files` (the tier's count). `readNamedFiles` takes the host load as an optional seventh argument. The facts beyond a file's own rows (lookup-only, the install command, the load, the worktree's not-current count) are in `src/cli/named-standing.ts`.
- `src/cli/named-file-lines.ts`: `classLines` prints a block per class, a line per group (`  3 queued behind the vitest tier of 4 test files running since 16:14:56: a, b, c; no command runs them sooner (...)`), current files grouped by verdict. `reasonGroups` counts the pending files while any is, else every file without a current result, as `noVerdictText` does, and ends a group with `` : `<command>` `` when it has one. `fileEntry` adds `next` and `command` to each `--json` entry. `unmatchedText` gives gh-39's base and root reading.
- `src/core/status/unknown-files.ts` and the scheduler's unknown records: an additive structured `cause` (`UnknownCause`: `timeout`, `install`, `runner`, `setup`, `never-run`). The scheduler records the first four (`tiers.ts` on a timed-out tier, `install.ts`, `failures.ts`'s `block`, `setup.ts` passing `setup` to `block`), and status derives `never-run`. A record without one, from an older daemon, gets the generic `retry` step: the timeout is never matched by its words. The record reader drops a cause value it does not know and keeps the record.
- `src/cli/status-wait-paths.ts`: `NamedSelection.unmatchedPaths` (additive) keeps each unmatched path as given, the directory it was resolved against and, for a relative path given below the root, the listed test file the same path names from the root. It uses the rows `selectNamedFiles` already reads, with no further store read; `selectNamedFiles`' closure read (011-44) is unchanged.
- `src/cli/retry.ts`, `HELP`: `--reason` is optional (C5 as amended, Q3 option 1). A file with no result at its key runs once without one. A counted failure (a current FAIL) without one is refused for that file, exit 1: `Not retried: <file> has a known failure at its inputs; a retry of it needs --reason load or --reason environment, the cause outside the code.` A reasonless request is stored with `reason: "environment"`, since older readers require a reason and such a run starts at once anyway.
- `src/core/retry/text.ts` (`waitsText`), `pending.ts`: a pending `load` retry the load lets run says `runs at the daemon's next look: the one-minute load average is below the CPU count (...)`. One whose run is open says `running since HH:MM:SS` (`PendingRetry.runningSince`, additive, from the live daemon's open runs, which `snapshot.ts` passes).
- `src/core/text.ts`: `timeText`, local `HH:MM:SS`, which `next-step.ts` and `retry/text.ts` share.

## Seam map

- What a named wait says of each file: `readNamedFiles` (`src/cli/named-files.ts`) builds `NamedFile.standing` from the rows and states it already reads. `nextStep` turns a standing into words, `classLines` and `reasonGroups` (`named-file-lines.ts`) group them, and `namedClassLines` and `namedLine` (`status-wait-lines.ts`) print them. `fileEntry` gives `--json`.
- Why a file is `unknown`: `Ledger.markUnknown(entries, reason, { ran, cause })` → `recordUnknownFiles` (`src/core/scheduler/unknown-files.ts`, one `meta` row per worktree) → `unknownReasons().of` (`src/core/status/unknown-files.ts`), which returns the record when its key is the row's, else derives the reason → `unknownStanding` (`named-standing.ts`).
- The pending retry line: `pendingRetriesOf(store, keys, load, runs)` → `StatusSnapshot.pendingRetries` → `retryLines` (`src/core/status/format-status.ts`) → `waitsText`.
- `readNamedFiles` runs once, when a wait ends, never at a poll, so `test/cli/wait-reads.test.ts` stays green. The claimant lookups for stale and unknown files and the not-current count read nothing new at a poll.

## Files of other rows

- 011-26 (`wip/011-26`): needed `src/cli/status-wait-lines.ts`, in three places: the `named-file-lines` import (line 11), and `namedLine`'s `unmatched` and `settled` cases. 011-26's hunks are its `core/status` import (lines 4-9) and `worktreeText`. Also needed `src/core/status/format-status.ts` (`retryLines`, two lines) and `test/status/status.test.ts` (one spread in `unknownTestFiles`). `checks.ts`, `verdict.ts` and `src/core/state/file-class.ts` are untouched, and `named-files.ts` still imports the class through `./verdict.js`'s re-export. A trial `git merge-tree` of this branch with `wip/011-26` is clean, and the merged tree typechecks. In it, 112 test files (1,817 tests) pass: the next-step rows, `status-wait-reasons`, `-paths`, `-promoted`, `-paths-slow`, `retry-no-reason`, `test/status/` and `test/evals/`.
- 011-25 (`cand/0.1.229`): none of `src/core/scheduler/{namesakes,edit-cut,refinement,bootstrap}.ts` changed. `bootstrap.ts`'s `block(ledger, failures)` keeps the default `runner` cause.

## Guarded sources

This row changes guarded sources, so it rides a bundled release. `KEY_FORMAT_VERSION` was not raised. The guarded files changed: `src/core/scheduler/{failures,install,ledger,setup,tiers,unknown-files}.ts`, `src/core/types/status.ts`, `src/core/text.ts`, `src/core/retry/{text,pending}.ts` and `src/cli/main.ts`. Every scheduler change is the additive `cause`, and none changes what is run, keyed or stored as a result.

The expected failures, all until the coordinator raises the format and rebuilds the bundles:

- `test/keys/key-format.test.ts`: `KEY_FORMAT_VERSION > is bumped whenever the guarded sources change`, and `an adapter-only bump > of src/runners/node-test/version.ts keeps the global pin` and `> of src/runners/vitest/version.ts keeps the global pin`. Both adapter-only tests compare with the pinned hash.
- `test/keys/validity/compare.test.ts`: `the candidate against the last release > keeps every stored meaning, or raises`. It reports `changed lines no case runs` in `src/core/scheduler/unknown-files.ts` (the `cause` field and `knownCause`) and `src/core/scheduler/ledger.ts` (`markUnknown`'s `cause`). Under 011-39's decision 4, a raised format is reported, not failed, so the bundled release's raise clears it. Once R4 (011-41) replaces the guard, these lines need a case under `test/keys/validity/cases/`. They write the `unknownFiles` meta row, which no key or result reads.
- The four bundle-drift tests, each `cli/squeal.mjs differs from the build` (`test/harness/bundle-helpers.ts:122`): `test/harness/plugin.test.ts` ``bundles > are committed exactly as `npm run build` produces them``, `test/harness/codex/plugin.test.ts` ``committed Codex plugin > has the bundles exactly as `npm run build:plugin` produces them``, `test/harness/opencode/package.test.ts` `the OpenCode package > has the bundles ...` and `test/harness/pi/package.test.ts` `the Pi package > has the bundles ...`. `npm run build` was not run, per the brief.

The 001-390 fidelity tests fail on main too: `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`.

## One test per row of section 3's table

| Row | Test |
| --- | --- |
| No daemon validating | `test/cli/next-step-rows.test.ts` "no daemon validating: `squeal start` starts one"; pure: `test/status/next-step.test.ts` |
| Discovery, the revision not listed | `test/cli/status-wait-reasons.test.ts` "revision not listed yet, ..." (named: no step); pure: next-step.test.ts (status: the wait) |
| Stale, nothing queued, lookup-only (gh-38 A) | next-step-rows "gh-38 A: a stale file under lookup-only, selected by a source path, names its retry" |
| Unknown, never run, nothing queued | next-step-rows "never run at its inputs, ..." and "four never-run files name <test file>... and how many files run --all runs (Q5)" |
| Timed out in a tier of its own (gh-43) | next-step-rows "gh-43: timed out ... with the load at or above the CPU count"; the scheduler records its cause: `test/scheduler/timed-out-tier.test.ts` |
| Ran and recorded nothing | next-step-rows "ran and recorded nothing: ..."; "a record without a cause, an older daemon's, is matched by no words" |
| Its project's global setup failed | next-step-rows "its project's global setup failed: ..."; the scheduler records `setup`: `test/runners/vitest/setup-failure.test.ts` |
| No key, a runner call failed | next-step-rows "no key, a runner call failed: ..." |
| No dependencies installed | next-step-rows "no dependencies installed: the header's install command installs them" |
| Another worktree's claim | `status-wait-reasons.test.ts` "waiting for another worktree's run of its key, ..." (pending); the order rule: next-step-rows "the order rule: a stale file whose key another live worktree runs names the claim, not retry" |
| Slow | `status-wait-reasons.test.ts` "slow, run ... under slow.trigger ..." (both triggers); `next-step-pending.test.ts` gh-40 B |
| Running alone | next-step-pending "running alone in its run: no step is needed" |
| In a run of several files (gh-40 A) | next-step-pending "gh-40 A: inside a running 27-file tier, ..." |
| Queued behind a running tier (gh-40 B) | next-step-pending "gh-40 B: queued behind a running 4-file tier and one slow file, ..."; status's step: next-step.test.ts |
| Queued, nothing recorded holds it (gh-41) | next-step-pending "gh-41: queued with no open run, ..." |
| A pending retry | `test/status/pending-retries.test.ts` "a pending retry says when it runs (011-27, gh-41's comment)": below the load, running since, a no-result run |
| A checkpoint in progress | today's line, `test/status/checkpoint.test.ts:105`; pure: next-step.test.ts (for R4's `Outstanding:`) |
| A running slow file with a global setup (gh-46) | next-step-pending "gh-46: ... names its one-file retry" and "gh-46: without a setup the store knows of, ..." |
| An unmatched path (gh-39) | next-step-rows "gh-39: an unmatched path names the directory it was resolved against and the root's test file" |

`retry` without `--reason`: `test/cli/retry-no-reason.test.ts` runs a stale, a never-run and a timed-out file and is refused on a counted failure. A mixed call takes the files it can, refuses the rest and exits 1.

## What the design did not foresee, and the choice made

1. **The unlisted row in a named wait names no command.** The design's `` `squeal status --wait 60000` waits for it `` is a pathless wait on the whole worktree, the wrong advice inside a named wait, whose reason already gives the per-call bound. `nextStep(s, { named: false })`, which R4's `Outstanding:` will use, keeps it.
2. **A slow file under `slow.trigger: "idle"` keeps its wording on the verdict line**: `` 1 slow, run when the agent pauses or on `squeal run --slow` ``, which 004-80 pinned, where `continuous` gives the design's `` 1 slow: `squeal run --slow` ``.
3. **The verdict line keeps `noVerdictText`'s parenthetical before the groups**: `` 1 test file without a current result at revision 2 (1 stale): 1 stale, nothing queued it: `squeal retry tests/a.test.ts` ``. The design's sample drops `(1 stale)`, but `noVerdictText` is in `verdict.ts`, 011-26's file. Dropping it when the rows merge is one line there.
4. **Commands name their paths from the cwd.** `retry` resolves its arguments against the cwd, so the worker's root-relative paths missed their file from a subdirectory, as in gh-39. The review of cand/0.1.231 (B1) proved it, and the coordinator's repair keeps the directory the selection was resolved against (`NamedSelection.base`) and prints each command's paths relative to it (`fromBase`); a cwd outside the root keeps the root's reading. No root fallback in `retry`, as the design rejected.
5. **A reasonless retry's record says `environment`** (above). Status's pending-retry line for a no-result run no longer names its reason (`(no result at its inputs)` for `(load, no result at its inputs)`), since that reason never meant anything for such a file.
6. **`--json` values, not only shape**: a pending entry's `reason` is now the class line's reason for that file, for example `queued; no run is open and nothing recorded holds it` where it was `queued`. A stale entry gains a `reason`, and every entry may gain `next` and `command`. `status --json`'s `unknownTestFiles` entries gain `cause`.
7. **The count in `run --all --wait runs all N test files not current here`** is every listed test file whose class is not `current`, pending ones included, counted from the rows `readNamedFiles` already read. On merge with 011-26, `header.testFileCounts` gives the same number.
8. **`test/status/pending-retries.test.ts` pinned the host's real load** in its regex. Now that a `load` retry below the CPU count reads differently, the test pins the load.
9. **`references/commands.md`** (three copies) has no `retry` text today, so nothing there is false. Design section 4's "and `retry` for a file without a result" is left to R3, which rewrites that file's wait sections, or to the coordinator.

## Type changes (all additive)

`UnknownTestFile.cause?: UnknownCause` and the type `UnknownCause` (`src/core/types/status.ts`); `PendingRetry.runningSince?: EpochMs`; `UnknownFileRecord.cause?: RecordedCause` (`src/core/scheduler/unknown-files.ts`); `Ledger.markUnknown`'s options gain `cause`; `block(..., cause = "runner")`; `NamedFile.standing?: Standing`; `PendingReason` `running.files?`, `running.setup?`, `queued.files?`; `NamedFileEntry.next?`, `command?`; `NamedSelection.unmatchedPaths?: UnmatchedPath[]`; `readNamedFiles(..., load?)`, `pendingRetriesOf(..., runs?)`, `waitsText(..., runningSince?)`.

## Verification

`npm ci`, `npm run lint` (`Checked 1528 files ... No fixes applied.`) and `npm run typecheck` are clean. `squeal run --all --wait`, checkpoint 38cb1cbe, completed at revision 42 (HEAD bef82c12, clean): 753 test files, 7,125 checks passed, 11 known failures. Ten are the expected ones above: four bundle drift, three key-format, `compare.test.ts` and the two 001-390 fidelity tests. The eleventh, `test/harness/opencode-dispose.test.ts` `serve: an abort of the new turn, then the old Stop's answer, stores nothing`, killed a held Stop at +2018 ms against a +2000 ms deadline at revision 14, 1.77 load per CPU. This row changes no harness file. `squeal retry --reason load` ran it again at the same inputs and it passed: a flake under load.
