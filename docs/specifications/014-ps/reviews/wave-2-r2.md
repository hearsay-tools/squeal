PASS 483384825813459bc8de3e13bd9f210c8d7cafcf

Zero blockers. Zero should-fix items. One proven note about the known host failure. The four proven blockers and N3 from `wave-2.md` are closed. This is the narrow re-review of `62d695300..483384825` on `cand/0.1.240`. It covers the 014-13r repair, its rebuilt CLI bundles and the spec amendments. Settled round 1 areas are not reviewed again.

## Verification output

`git rev-parse HEAD` returned `483384825813459bc8de3e13bd9f210c8d7cafcf`. Product verification ran with a clean tracked tree at that commit. The reviewer changed no product code. `npm ci` installed 196 packages and completed successfully (its audit reported one high-severity advisory). `npm run lint` reported `Checked 1641 files ... No fixes applied.` `npm run typecheck` completed with exit 0. No build ran, as the brief requires.

The required independent run used `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once. It started at 16:53:53 UTC and ended at 17:15:50 UTC on 2026-10-21. The three load averages were `45.91 51.36 46.36` at start and `37.12 42.37 43.18` at end.

```text
Test Files  1 failed | 814 passed | 1 skipped (816)
     Tests  2 failed | 7088 passed | 10 skipped (7100)
  Duration  1315.59s
FULL_EXIT=1
```

Both failures were in `test/e2e/shipped-plugin.test.ts`: the Claude Code PostToolBatch and Codex PostToolUse passing-baseline cases. Both failed with `timed out waiting for a passing baseline` at their 60 s bound. Every other file passed or was skipped, including the repaired ps tests.

The failed file was rerun alone with `npx vitest run test/e2e/shipped-plugin.test.ts --maxWorkers=1`. It reproduced the same two passing-baseline timeouts, with no different failure. The three load averages were `48.43 49.83 46.32` at 17:25:07 UTC and `60.68 55.22 48.87` at 17:27:22 UTC.

```text
Test Files  1 failed (1)
     Tests  2 failed | 5 passed | 1 skipped (8)
  Duration  132.99s
ALONE_EXIT=1
```

This was the only failed file, so no other isolated rerun was needed.

All command probes used disposable fixture HOME, runtime, temp and process trees. None read this host's live daemons or ran `squeal ps` on the real HOME. Direct probes were bundled under `/tmp`; only the probes' disposable bundles substituted pre-fix modules for counterfactual checks. The candidate files remained untouched. Native test counterfactuals ran in an archived copy under `/tmp`, with the inherited Cez TMPDIR inside the real repository.

## Closed findings

### B1. Closed / proven: host-wide flags read the full table

Locations: `src/core/ps/flags-files.ts:224`, `src/core/ps/flags-processes.ts:73`.

`leftover-temp` and `orphan-waiter` now use the first reading's full table. The second reading remains the smaller set needed for measurement and two-reading rules. A direct real-ProcSource snapshot probe used ordinary shell processes that hold old directories by cwd or argv, plus an unmarked waiter whose parent is gone and another whose parent lives. It retained only the truly unused directories and flagged only the orphan waiter. With both flag modules from before `88e8fb4c2`, the identical probe failed (exit 1); at the candidate it passed.

Committed regressions: `test/ps/snapshot-flags.test.ts` checks real flags through the snapshot and asserts that the second table holds only the daemon. `test/cli/ps.test.ts` checks the actual leftover list and orphan waiter through the command. `snapshot-cost.test.ts` now exercises the real flag path with 100 old directories on the 650-process host and bounds the added cwd/argument reads. This closes the integration-coverage gap named in round 1.

### B2. Closed / proven: paths keep spaces, quotes, equals signs and colons

Location: `src/core/ps/flags-files.ts:231`.

The use check now reads a cwd or an argv element as a whole path, or reads the value after `<option>=`. It cuts only at `/`. A name with `=` does not become an option when it already starts with the temp prefix. Direct model probes cover spaces, each quote, `=` and `:` in cwd and option arguments. Only the unused control directory was returned. The same probe failed with `flags-files.ts` from before `b18c8e5ce` and passed at the candidate. The committed parameterized regressions also check bare arguments, both directory classes, descendants and unused prefix neighbors.

### B3. Closed / proven: unread worker costs remain unknown

Location: `src/core/ps/render.ts:178`.

With no descendants, the row prints the worker's own value. With descendants, a sum is unknown if either input is unknown. A direct renderer probe set CPU percent, cumulative CPU, memory and swap to null beside zero empty-descendant sums. All four columns printed `?`. The identical probe failed with the renderer from before `444e614b1` and passed at the candidate. Committed render regressions cover a vanished worker, RSS swap and a null part of a nonempty descendant sum.

### B4. Closed / proven: failed macOS process enumeration exits 3

Location: `src/core/ps/darwin.ts:196`.

A null runner result now throws a specific error. The unchanged CLI error path emits no snapshot and exits 3. A successful empty string remains an empty host. Direct injected-Darwin-source command probes tested failure on the first read, failure on the second read after a fixture daemon table, and a successful empty host. They passed at the candidate and failed with `darwin.ts` from before `43ce28104` (the failed command returned exit 0). The source test distinguishes null from empty output, and `test/cli/ps-macos.test.ts` commits the first-read, second-read, empty and successful-daemon cases.

### N3. Closed / proven: outside-repository tests no longer depend on TMPDIR

Location: `test/cli/ps.test.ts:133`.

Both outside-repository cases use the existing `outsideGit()` helper, which creates a directory directly under `/tmp`. All 22 CLI tests passed in the disposable candidate copy with the inherited Cez TMPDIR still inside the real repository. Replacing only that copy's test with its pre-`fa8a92ad6` version reproduced the old failure: the `--repo` case expected 2 and received 0. The second outside-repository case passed. This confirms that the test fixture, rather than production root discovery, caused the old failure.

## Additional delta

- **Fits / proven, `bc7fb0eab`:** the size-walk test now ages its directory after adding files, so it does not reset mtime to the real clock. The isolated size-walk case passed at the candidate (1 passed, 20 skipped). Replacing only the disposable copy's test with its pre-fix version failed (expected 35 bytes, received undefined), because the directory no longer qualified as old.
- **Fits / proven, `b6c145b73`:** the use check maps a path below `realpath(tempDir)` back to the configured temp prefix. A symlink-temp probe kept all cwd and argv uses under the real path and returned only the free directory. It passed at the candidate and failed with the module from before this commit. The committed symlink fixture checks ordinary and keyed directories. This proves the path rule on Linux fixtures; actual macOS behavior remains unverified, as D10 permits.
- **Fits / proven, amended spec:** D7 now states full-first-table host rules, path boundaries, option values and the real temp path. These match the two flag modules. The D8 null-output contract and the added descendant wording under D5 match the renderer. D10 now distinguishes failed enumeration (exit 3) from successful empty enumeration. `status.md` names each accepted repair. The amendment log calls the descendant rule D8; its detailed sentence is in D5, which defines descendants. The behavior is consistent.
- **Fits / proven, read-only and exits:** the delta adds a realpath read, table selection, string parsing, null-preserving arithmetic and an error throw. It adds no write, signal, socket connection, daemon start or execution of an end command. `src/cli/ps.ts`, `src/cli/main.ts` and `flags-text.ts` are unchanged. Exit 0/1 still follows the flag count; usage remains 2; failure remains 3; `--leftovers` remains 0. Shell quoting and newline exclusion are unchanged. CLI and flag tests cover these contracts.
- **Fits / proven, scope:** `git diff --exit-code 62d695300..483384825 -- src/core/ps/{source,proc,shape,model,discover,work,measure,processes,host}.ts` returned exit 0. All nine reviewed wave 0/1 modules are unchanged. The four bundle diffs contain the corresponding repaired CLI logic; bundle rebuilding was not repeated in this review.

## Findings and next-wave inputs

No blocker or should-fix remains in this re-review. Round 1's duration-format note remains a presentation note outside this repair. The board now records the implementation as in review and the prior FAIL/repair, so its old running/planned mismatch is no longer the round 1 state.

### N1. Note / proven: the known shipped-plugin baseline failure remains on this host

Location: `test/e2e/shipped-plugin.test.ts:74`.

The full run and isolated rerun show the same two 60 s passing-baseline failures described by board row 014-17. The coordinator's supplied baseline evidence reproduces them on released tag `squeal--v0.1.238`, and CI passes the candidate's existing baseline cases. This review reproduced the failures at the pinned candidate; it did not repeat the released-tag or CI investigation. No different failure appeared. Per the re-review brief, these host failures do not count against this candidate. The underlying host cause remains unverified and belongs to 014-17.

Shipped-bundle integration and the live-store/socket no-side-effects proof remain row 014-14. The real-host cost measurement remains 014-15. A first run on macOS remains unverified and belongs in `lessons.md`. These are the existing next-wave obligations, not new blockers.
