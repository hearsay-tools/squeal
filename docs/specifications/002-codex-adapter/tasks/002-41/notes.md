# Dispatch contention assertions (002-41)

2026-10-27. Base `da6e5e3a6`. Test-only repair of review
`reviews/0.1.368-r2.md` S1 against the approved D8 busy/no-pin contract.

## Reproduction before edits

The worktree had dependencies. Hook setup had failed because Codex listed no
installed Squeal hooks. The first explicit read confirmed no validation daemon:

```text
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/harness/codex/adapter/dispatch.test.ts
Exit 3, revision 0: Named test files have no verdict: no daemon is running.
```

With no daemon validating yet, ran the named test directly, before editing:

```text
pnpm exec vitest run test/harness/codex/adapter/dispatch.test.ts --reporter=verbose
Exit 1; Test Files 1 failed (1); Tests 2 failed | 9 passed (11); Errors 3 errors.
Duration 1.82s.

first-hook race: concurrent first hooks of one session, beside a publication, share one pin
Unexpected end of JSON input at dispatch.test.ts:38:17

concurrent first contacts of new sessions publish the seed once
expected Set{ '0.1.900', undefined } to deeply equal Set{ '0.1.900' }
at dispatch.test.ts:124:48

Three unhandled rejections also came from the empty-output JSON parse.
```

Started the worktree daemon explicitly with
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal start` (exit 0).
The final status below confirms it runs and owns the current results. No plugin
installation or user trust change was needed for this explicit validation path.

## Repair and seams

- Moved the dispatch fixture into the adjacent `dispatch-helper.ts`. Its `hook`
  returns a test-only union: runtime JSON, exact selection-busy context, or
  silent output at a hook without a context channel. It checks exit code,
  stderr, the full context event/text and the full runtime payload. Invalid
  JSON, other diagnostics and silent context hooks fail immediately.
- `dispatch` requires runtime execution. Existing ordinary and missing-runtime
  cases retain their assertions. No successful call may pass as a busy result.
- Reused the real `selection-owner.ts` child without changing it. Its IPC
  readiness proves `BEGIN EXCLUSIVE` is held before each first contact. Ten
  cases cover every runtime hook. Each requires busy context or permitted
  silence, no pin and no current record. Release is acknowledged by child exit.
  The same hook then dispatches A and creates a valid pin. SessionEnd releases
  its pin by contract, so that case also checks release and a later contact's
  valid pin. Cleanup kills any holder left by a failed assertion.
- Concurrent first hooks require at least one successful dispatch. All
  successful versions must equal the one valid session pin. Every raced hook
  then dispatches again on that pin. Publication selects B and current stays B;
  only A/B runtime directories may remain. Promise aggregation attaches before
  the publication delay, avoiding the old detached-rejection window.
- Existing pins are compared byte for byte after nine concurrent hooks beside
  publication of B. All nine run A; a new session runs B. SessionEnd is excluded
  here because it intentionally removes a pin and remains covered separately.
- Six separate first contacts must each reach execution and a valid A pin.
  Only the exact busy context permits up to five additional hook attempts.
  The racing publication permits one retry, after the hook batch finishes,
  only for a typed `RuntimeError` with kind `selection-busy`. Other errors and
  silence never trigger retry. No downgrade assertion was removed.

## Verification after repair

```text
pnpm exec biome check --write test/harness/codex/adapter/dispatch.test.ts test/harness/codex/adapter/dispatch-helper.ts
Exit 0; Checked 2 files in 15ms. Fixed 1 file.

pnpm run lint
Exit 0; Checked 2523 files in 981ms. No fixes applied.

pnpm run typecheck
Exit 0; tsc --noEmit.

/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/harness/codex/adapter/dispatch.test.ts test/harness/codex/adapter/dispatch-helper.ts
Exit 0; revision 3, da6e5e3a + 3, dirty.
Selected: test/harness/codex/adapter/dispatch.test.ts, test/version-sensitive.test.ts
Not a listed test file: test/harness/codex/adapter/dispatch-helper.ts; it selects the 2 test files that read it
Named test files at revision 3: no known failures; 2 test files, each with a current result, after 1.5 s.
Worktree: known failures 0; not current: 1285 of 1305 test files (1285 unknown).

/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --full test/harness/codex/adapter/dispatch.test.ts test/harness/codex/adapter/dispatch-helper.ts
Exit 0; same two named files current at revision 3, no known failures.
Daemon: running, last heartbeat 1 s ago.
Inherited from other worktrees: none (every current result here was run in this worktree).
Affected checks: 171 passed (151 tests, 20 test files loaded), 0 running, 0 queued.
The affected-check count is for the worktree, not only the two selected files.

git diff --check
Exit 0, no output.

git diff --exit-code -- src plugins package.json pnpm-lock.yaml docs/board.md docs/specifications/002-codex-adapter/status.md
Exit 0, no output.
```

No full suite, full-suite checkpoint or product build ran. Unrelated unknown
files remain unknown. The direct Vitest run above is the red reproduction;
Squeal supplied the repaired test results without a duplicate direct run.
After writing these notes, the same named `status --wait 60000` read passed
at revision 4: both files current, no known failures, after 0.8 s. The worktree
still had 1285 unrelated unknown files. Scope and whitespace checks stayed clean.

## Decisions and remaining work

The helper split, five hook retries and one publication retry are test choices.
The spec settles the product behavior; no unsettled product decision remains.
The only type addition is the test-only `HookResult` union. No product API,
generated output, version, board, status or sibling research changed.

The parent must integrate and review this test delta. This work does not resolve
or override the separate Node 24 coverage CI failures recorded by the review.
