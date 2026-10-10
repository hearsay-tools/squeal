# Wave 13ab review (001-251)

PASS `cb947c2576ba188e5b164144d74adc249685444f`. B1, B2, B3 and S1 from `wave-13aa.md` are closed. No new product blocker; one proven, nonblocking documentation note.

Range: `1b762976..cb947c25`. Bounded second-round review of the 001-250 repair, including its 0.1.110 rebuild and in-place re-pin of unreleased `KEY_FORMAT_VERSION` 4. The previous review's settled timing-test and watcher-recovery judgments are not re-prosecuted.

## Verification

Verification started on a clean tree at `5bd94d1ec36c127ff23df0e2dea1f2e43245876e`, not exactly the candidate. `git diff --stat cb947c25..HEAD` showed only `docs/board.md` (two insertions, two deletions). Product sources, tests, configuration and committed bundles match the requested candidate. The exact-candidate checkout check is **unverified**; the following outputs are independently verified at the stated documentation successor. No project file changed while checks ran; probes and the draft stayed outside the tree.

```text
npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
exit 0

npm run lint
> squeal@0.1.110 lint
> biome check .
Checked 775 files in 503ms. No fixes applied.
exit 0

npm run typecheck
> squeal@0.1.110 typecheck
> tsc --noEmit
exit 0
```

`npm ci` also warned that the install scripts for `@parcel/watcher@2.6.0` and `esbuild@0.28.2` were not covered by `allowScripts`; installation exited 0.

Independent full suite, required by the review task rather than substituted by Squeal:

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
```

```text
 FAIL  test/scheduler/claims.test.ts > claims: two worktrees on one store (task 001-205) > 6. another worktree's stored fail at a key runs here (001-170), with a claim on it
Error: Test timed out in 5000ms.
 at test/scheduler/claims.test.ts:73:5

 Test Files  1 failed | 353 passed | 1 skipped (355)
      Tests  1 failed | 2569 passed | 9 skipped (2579)
   Start at  00:56:35
   Duration  505.11s (tests 98%, import 1%)
exit 1
```

The failed case took 7,954 ms in the file summary and exceeded its 5 s test timeout. Its scheduler/claims implementation and test are unchanged by this range; only the watcher helper, primer/coverage, key-format pin and rebuilt bundles change. All repair regression files passed in this full run. The failure is **proven** as a gate result, but its cause and any connection to the repair are **unverified**. It does not establish a product blocker in this bounded review.

The affected file passed three consecutive isolated repeats using the same environment and worker flag:

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/scheduler/claims.test.ts --maxWorkers=4
```

```text
Round 1: Test Files 1 passed (1); Tests 7 passed (7); Duration 3.28s; exit 0
Round 2: Test Files 1 passed (1); Tests 7 passed (7); Duration 5.42s; exit 0
Round 3: Test Files 1 passed (1); Tests 7 passed (7); Duration 2.88s; exit 0
```

That supports a load-sensitive explanation (**plausible**), without proving its root cause or replacing the failed full-suite gate.

The run also printed two fixture gitdir-repair notices and a nested run's startup notice that it killed one process left by an earlier run. These were not failed checks. Background Squeal separately reported load-sensitive failures and recoveries, including the directory-read regression's timeout and same-input recovery; those results are not substituted for the independent run.

`npm run build` was excluded by the dispatch instruction. Build/bundle drift remains **unverified** by this reviewer. Supplied coordinator evidence: 2,569 passed and two 5 s timeouts (harness-process and attribution), each affected file passed alone three of three; CI green. These are supplied results, not this reviewer's checks.

## Blockers

None from the repair or repeated first-round probes.

## Re-check of the first-round findings

### B1 closed: runner selection agrees with the daemon (**proven**)

`src/harness/shared/coverage.ts:52` uses the same rule as `src/core/daemon/daemon.ts:326`: build Vitest when no node:test project is configured, or when `vitestDetected(root)` detects it. `primer.ts:48` renders both the opening and its test-running instruction from that representation.

Repeated the original node:test-only probe with a real policy, manifest containing only `{"type":"module"}`, no Vitest/Vite config, a real SQLite store, and both SessionStart handlers. Daemon ensure was stubbed; no claim is made that a real daemon completed a listing. The before module was loaded from `1b762976` with imports redirected to the unchanged supporting modules; candidate hooks used candidate sources.

```text
BEFORE: Squeal covers Vitest and node:test project "scripts" (scripts/*.test.mjs).
Claude Code: Squeal covers node:test project "scripts" (scripts/*.test.mjs).
Codex: Squeal covers node:test project "scripts" (scripts/*.test.mjs).
```

No false Vitest claim remains in this case. The committed SessionStart matrix now includes node:test-only, as well as Vitest-only, mixed, slow and all-three cases, under both harnesses.

### B2 closed: retained rows do not invent projects (**proven**)

`coverage.ts:58-61` names the root config and node:test policy entries, never projects reconstructed from key rows. Slow counts are expressly qualified as being at the daemon's last listing (`primer.ts:94`); they no longer present retained rows as a fresh listing.

Repeated the removed-node probe under both SessionStart handlers, with `vitest.config.ts`, current project `scripts`, and the retained row `{project:"removed-node",path:"scripts/old.test.mjs"}`:

```text
BEFORE: Squeal covers Vitest (vitest.config.ts, project "removed-node") and node:test project "scripts" (scripts/*.test.mjs).
Claude Code: Squeal covers Vitest (vitest.config.ts) and node:test project "scripts" (scripts/*.test.mjs).
Codex: Squeal covers Vitest (vitest.config.ts) and node:test project "scripts" (scripts/*.test.mjs).
```

An additional removed Vitest slow-row probe produced the same qualified count under both harnesses:

```text
BEFORE: Squeal covers Vitest (vitest.config.ts, project "old-vitest"), with 1 slow test file.
AFTER: Squeal covers Vitest (vitest.config.ts), with 1 slow test file at the daemon's last listing.
```

The count describes retained listed rows, not the current filesystem. The committed regression also filters retained Vitest rows when no Vitest runner is selected. No hook waits for baseline or executes the Vitest config.

Repeated the cold-config probe naming `unit` and `browser`: both handlers say `Squeal covers Vitest (vitest.config.ts).` This continues to satisfy the original "config or projects" alternative. Names from a runner listing are deliberately absent. Detection through a manifest or workspace file with no root config yields the general `Vitest` label, as in the prior review; it is not a complete project inventory. Configured node:test entries retain their names and cwd-relative globs, or a counted folded summary when the list is long.

### B3 closed: long CLI paths preserve the primer (**proven**)

`primer.ts:61-65` folds projects, then names the CLI only once, then refers to the CLI named by SQUEAL messages. The unchanged Codex cap recognizes the resulting bounded trailing paragraph.

Repeated the exact original 250-character path-component probe with slow files, real `codexCommand`, and 9,000 characters of preceding context:

```text
BEFORE: command=371, primer=1605, trailing=false, closing=false
AFTER: command=371, primer=1272, trailing=true, closing=true
```

Also checked 72 variants: Claude Code and two Codex command lengths; Vitest present/absent; zero, one and 40 node:test projects; slow absent, not counted, zero and three files. All fit the 1,500-character primer cap and retain the entire closing sentence after Codex truncation. Maximum observed primer length: 1,500. The longest command fixture forces the fallback with no embedded CLI path. The committed tests additionally exercise SessionStart with the long path.

Repeated `trailingPrimer`'s opening-collision probe: an earlier matching diagnostic paragraph does not capture the real final primer; the capped text retains it. A final matching single diagnostic paragraph remains a bounded false positive. This behavior is unchanged, and the previous review did not call it a blocker.

### S1 closed: enumeration has its own budget (**proven**)

`src/core/watcher/root-recheck.ts:59-87` decrements a shared 4,096-read budget before skipping directories, named files or exclusions. The separate 1,024-stat budget and zero-content behavior remain. It closes each directory handle and leaves unexamined paths to reconciliation.

Repeated the original directory-only probe and extended it beyond the new budget, instrumenting the actual `node:fs` directory reads and stats:

```text
1,500 directories BEFORE: reads=1502, stats=0
1,500 directories AFTER:  reads=1502, stats=0
4,596 directories BEFORE: reads=4598, stats=0
4,596 directories AFTER:  reads=4096, stats=0
```

The smaller original fixture now legitimately fits the explicit read budget. The larger fixture discriminates the repair. The committed regression also checks the candidate stat budget and zero content opens across a batch naming two directories.

## Should-fix

### N1. Fold the repair's contracts into the spec and amendment log (**proven**, nonblocking)

Locations: `docs/specifications/001-core-loop/spec.md:58`, `:165`; `status.md` amendment log.

D2 records the 1,024-stat fallback but not the new 4,096-directory-read fallback. D9 still describes the unconditional Vitest opening and named projects from the runner's listed rows. The 001-250 brief supersedes those descriptions with selected runners and the config/policy fallback, but the amendment log does not record it.

Coordinator-sized repair: amend D2 with both budgets and their quiet-relative reconciliation fallback; amend D9 with the daemon selection rule, config/policy identities, qualified listing count and CLI-reference compaction; append a dated 001-250 amendment. No product fix is requested. This review does not edit the spec, status or board.

## Nits

None.

## Answers to the 001-251 brief

1. **Are B1, B2, B3 and S1 closed?** Yes, with independent before/after evidence above. The smaller S1 fixture needs the explicit larger-budget companion to turn red before the repair.
2. **Can the primer claim an unconfigured runner/project, or omit a configured one?** The reviewed cases no longer invent a runner or a project. Vitest follows the daemon's detected-or-default selection rule; node:test follows current policy. Vitest projects are represented through the root config, when present, and otherwise the runner label. Long node:test lists are counted when folded. A retained listing is not presented as today's discovered suite identity.
3. **Does every primer variant keep its closing sentence within the cap?** The independently exercised 72 variants do, including long CLI paths and every slow-count state. The fallback's final form has bounded fixed runner/config wording, a folded project count, and no unbounded CLI string. The coverage summary and full closing sentence survive Codex truncation.
4. **Is the repair's done-when met?** The first-round discriminators reproduce red before and pass after; the harness matrix and cap/budget regressions are included in the independent suite. Lint and typecheck pass. The independent full-suite green requirement is **not met**: one existing claims test timed out. The review does not claim a green full gate or prove that timeout is caused by this repair. Build is intentionally unverified; the dispatch supplies green CI. No new repetition claim is made for the original parcel or timing-test tasks; their prior evidence limitations remain as recorded in `wave-13aa.md`.

## What fits

- The shared `Coverage` interface adds `vitest` and removes `vitestProjects`; session, delivery and prompt callers still pass `(command, coverage)` in the same order. Both harnesses consume the same builder.
- The normal/slow and Claude Code/Codex instructions preserve their respective delivery semantics. The long-path fallback refers to the actual CLI through SQUEAL messages rather than presenting a truncated executable path.
- Root rechecks remain hints. They do not bypass hashing, keying or revision handling. The two-second mtime/ctime window and conservative failed-stat handling are unchanged.
- The rebuild changes the package/plugin version to 0.1.110. The key-format delta changes only unreleased version 4's hash, leaving versions 1-3 intact, as authorized.

## Inputs for the next wave

No product repair follows from this re-review. The coordinator owns N1's spec/status amendment and the decision on the red full-suite timeout with three isolated recoveries. Keep the runner-selection rule shared with daemon detection, keep key rows out of project identity, and preserve explicit listing qualification for slow counts. Keep the two watcher budgets independent and the remainder's fallback measured after the watcher goes quiet.

All temporary probe fixtures were removed; no product, test, bundle or board edit belongs to this review. The only committed deliverable is this findings file.
