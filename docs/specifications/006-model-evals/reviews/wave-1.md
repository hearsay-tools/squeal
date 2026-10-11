# 006 wave 1: review of 006-01

Candidate: `69f7eb0f`. Range: `c26cbb78^..69f7eb0f`. Board row: 006-03.

## Verification

Checks ran on a clean tracked tree detached at `69f7eb0f`. The initial checkout was `5733428b`, three documentation commits beyond the candidate. The parent approved detaching for checks and returning to `cez/888df087` to commit this file. The mismatch was resolved before verification.

```text
$ git rev-parse HEAD
69f7eb0f81b31d9565429792394cce4f9008daaf
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
$ npm run lint
Checked 812 files in 209ms. No fixes applied.
$ npm run typecheck
tsc --noEmit
exit 0
$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin
tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git diff --exit-code
exit 0 (no bundle drift)
$ npx vitest run
Test Files  4 failed | 355 passed | 1 skipped (360)
Tests       4 failed | 2596 passed | 10 skipped (2610)
Duration    282.07s
exit 1
```

Independent failures: `test/harness/primer-listing.test.ts:19`, `test/harness/session-start.test.ts:52` and `test/store/unkeyed.test.ts:12` timed out at 5 seconds. `test/scheduler/backlog-tiers.test.ts:89` measured 16,918 ms against a 15,300 ms limit. All four files are outside the changed range. Host one-minute load rose from about 25 to 91 during the run; load causality was not independently established. No second full run was made. No eval test file appears among the failures.

```text
$ node <installed-plugin>/dist/cli/squeal.mjs run --all --wait
Checkpoint ec19c83c-4ca2-4e23-b612-b5ade441862d started at revision 1: 0 test files
Checkpoint ec19c83c-4ca2-4e23-b612-b5ade441862d completed
Revision: 1
Known failures: 5
Affected checks: 2955 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 1
exit 0 (the installed version does not signal test failures by exit code)
```

The checkpoint used the already-current results and reran no files. Its failures were `step-down.test.ts` (equal/newer daemon), `turn.test.ts` (mid-turn waiter), `waiter.test.ts` (file-level closed database and transition timeout), and `adapter-observed.test.ts` (malformed key timeout). Squeal marked these failures flaky under identical inputs. Other earlier Squeal failures recovered; the five above remained in the final snapshot. The independent and daemon runs therefore disagree on which unchanged timing/liveness tests failed; neither result is called green.

Published evidence: [vitest.log](/p/squeal/tasks/888df087-4356-4b0d-9b91-bd88d6b65773/files?artifact=4ca3d407-f533-47f0-bd83-13ad8369928e) and [checkpoint.log](/p/squeal/tasks/888df087-4356-4b0d-9b91-bd88d6b65773/files?artifact=4831db99-697b-4bb5-ac67-02e0cedd8282).

The independent Vitest run is the reviewer gate. No product or test code was edited. Failures outside the candidate's changed files are verification limitations, not findings assigned to this wave.

Probes used synthetic transcripts, made-up credentials and scratch Git repositories under the reviewer's own `/tmp` directory. They started **0 subject sessions** and used no real credential or provider URL. The cell runner initially held a synthetic dry failure-path probe above load 24, then allowed it at load 11.3 and 10.4. Its fake Codex installer failed before any daemon or subject session started. No eval daemon was started. All scratch was removed before committing.

## Verdict

**FAIL: 5 proven blockers, 3 should-fix findings (2 proven, 1 plausible), 0 nits.**

The blockers violate 006-01's done-when or spec 006 goals 2 and 5. They do not depend on the unrelated full-suite failures.

## Blockers

### B1. Detected credentials remain in retained evidence

**Proven.** `evals/lib/scratch.mjs:128`; `evals/bin/run-cell.mjs:327` and `:335`.

006-01 says a cell “leaves no credential in its scratch”; the review brief explicitly includes `out/`. `clearScratch` deletes homes, temp files and dependencies, but retains `out/` and `work/`. A surviving secret is returned in `secretsAfterRemoval`; the runner only logs the count and exits normally. Harness transcripts are copied into retained evidence before this scan.

Probe: write one made-up token to `out/events.jsonl`, call `clearScratch(cell, [token])`, then check the file:

```json
{"secretsBeforeRemoval":["out/events.jsonl"],"secretsAfterRemoval":["out/events.jsonl"]}
{"fileRetained":true}
```

The baseline's public-results guard scans compact JSON, not the raw evidence.

The real runner was also probed with `--dry`, an isolated synthetic host config, an empty dependency cache and a fake `codex` installer returning exit 9. At load 10.4 it wrote the provider config, then threw at `run-cell.mjs:178`. The process exited 1, left the made-up inline token in `codex/config.toml`, and wrote no cleanup report:

```json
{"providerConfigsRetained":1,"syntheticTokenRetained":true,"scratchReports":0}
```

This proves cleanup is bypassed on a setup exception as well as leaving detected secrets on the normal path. The empty dependency cache is sufficient for this probe: installation fails before the runner attempts validation or starts a session.

**One-worker fix:** put cleanup around the cell lifecycle, remove or sanitize contaminated retained evidence and fail the cell if a recognized secret survives. Cover harness copies, logs, diff and store with synthetic-token cleanup tests. Never print matched values.

### B2. Syntactic commands are graded as completed execution

**Proven.** `evals/lib/shell.mjs:18` and `:115`; `evals/lib/grade.mjs:42`, `:51` and `:114`.

D4 requires grading actual runs, forbidden edits and chained-command quirks. The tokenizer discards conditional operators; the grader credits every classified action unless the whole tool call was refused. It also loses edit/action ordering inside one call and ignores executable shell heredocs.

| Probe command | Actual or expected action | Candidate grade |
| --- | --- | --- |
| `false && node --test scripts/changelog.test.mjs`, after a script edit, exit 1 | Test never executes | `nodeTestAfterScriptEdit: true` |
| `false && echo x > test/contract/invoice-json.test.ts`, exit 1 | No write | `forbiddenEdit: true` |
| `echo x >> scripts/changelog.mjs; node --test scripts/changelog.test.mjs` | Test follows edit | `nodeTestAfterScriptEdit: false` |
| `bash <<'EOF'\nnode --test scripts/changelog.test.mjs\nEOF` | Bash executes heredoc | `classifyShell: []` |

A scratch Bash control confirmed that the right-hand side of `false &&` emits no output. The first grade makes a session look better than its transcript; the second creates an unwarranted forbidden-edit warning.

**One-worker fix:** retain conditional structure and action sequence; distinguish executed, refused and indeterminate actions. Do not count indeterminate execution as established. Parse heredocs executed by a shell while ignoring fixture text passed to `cat`. Add transcript regressions for these cases and unsuccessful edit tools.

### B3. Interrupted ground truth becomes a successful run

**Proven.** `evals/bin/run-cell.mjs:256` and `:270`; `evals/bin/grade.mjs:37`; `evals/lib/grade.mjs:185`.

Goal 2 requires grading against the test run after the session. A timeout or signal can make `spawnSync.status` null, which the runner writes as `node:test exit null`. The grader's digits-only parser defaults a missing match to 0. Vitest's process status and signal are discarded entirely.

A scratch `out/` with a valid passing Vitest report, `truth.txt = "node:test exit null\n"` and `TESTS: pass` went through the real grader CLI:

```json
{"exit":0,"truth":{"vitestFailed":0,"failed":[],"nodeTestFailed":false,"pass":true},"claimTrue":true}
```

A direct probe also accepted empty `testResults` as passing. `groundTruthOf` ignores report-level success and process completion.

**One-worker fix:** persist structured completion evidence for both commands, including exit, signal, spawn error and timeout. Require explicit successful completion and a valid report before grading pass. Missing or interrupted truth is unavailable evidence. Test null, absent and invalid exit records through the CLI, plus report-level failure.

### B4. Stale and unknown results become Squeal's pass verdict

**Proven.** `evals/lib/grade.mjs:206`.

D4 grades the final claim against Squeal's state. The vision distinguishes current results from stale or unknown evidence. `squealState` reads known failures and only the first running/queued pair, ignoring stale/unknown checks, pending files without checks, incomplete discovery and runner refinement.

Probe, using the candidate renderer's wording:

```text
Revision: 3
Affected checks: 29 passed, 0 running, 0 queued, 1 stale, 1 unknown
Known failures: 0
Daemon: running, last heartbeat 1 s ago
```

Output: `{"knownFailures":0,"pending":0,"daemon":true,"verdict":"pass"}`. A pass claim is therefore credited as matching Squeal despite explicitly incomplete validation.

**One-worker fix:** capture structured status and use the full current-state contract. If keeping text parsing, recognize every uncertainty clause emitted by `src/core/status/format-status.ts` and fail closed on unsupported wording. Test stale/unknown checks, unlisted files, files without checks and pending refinement.

### B5. Instruction variants abort after sessions finish

**Proven.** `evals/bin/run-baseline.mjs:129`; `evals/bin/run-cell.mjs:136` and `:155`.

Goal 5 and D8 allow appended instructions and merged policy, running beside shipped texts. Each arm commits its instructions/config into the fixture, but aggregation requires one fixture commit across both arms.

Scratch Git repositories made from the candidate fixture, with identical identities and fixed dates, differed only in `p0` versus `gate-squeal` instructions. Their commits differed, triggering the aggregation condition:

```json
{"differentFixtureHeads":true,"baselineWouldReject":true}
```

The same contradiction applies to `block`, `gate-vitest`, `noplugin-block` and policy variants. It prevents writing results after the sessions have consumed their budget.

**One-worker fix:** validate fixture consistency within each arm, build each arm's conditions from its own fixture identity, and keep a common base identity separately if needed. Test two legitimate instruction arms and unexpected drift within an arm without starting models.

## Should-fix

### S1. Repeated baselines reuse cells and overwrite the same result

**Proven; non-blocking.** `evals/bin/run-cell.mjs:81`; `evals/bin/run-baseline.mjs:184`.

Cache keys contain commit and cell identity, not run identity. Two calls against a seeded scratch grade both returned exit 0 and `skip ...: already graded`. Results use only date/version, so a second same-day run overwrites the first. Resume is documented, but the default command cannot distinguish resume from a fresh repetition. A harness update at the same product commit can also reuse old sessions.

**One-worker fix:** add fresh-run identity, explicit resume and unique result names. Before 006-04, use separate scratch roots and result names, or implement that control, so both independent runs survive.

### S2. Daemon and session teardown on exceptional exits remains unverified

**Plausible; non-blocking.** `evals/bin/run-cell.mjs:175`, `:237` and `:335`; `evals/lib/session.mjs:85` and `:106`.

B1 proves that a setup exception bypasses scratch cleanup. Extending that route to failures after warm-up suggests daemon residue: a harness spawn error has no error handler, while timeout sends SIGTERM only to the harness, without a forced deadline or process-group fallback. There is no runner-level finally or termination handler. No live daemon or hung harness was used to reproduce those later failure routes, so daemon/process residue remains unverified and this note does not block independently.

**One-worker fix:** centralize finally/termination cleanup, handle spawn failures and bound process-tree/daemon shutdown. Preserve safe failure metadata. Use fake harness binaries in tests.

### S3. Inline provider credentials escape the results guard

**Proven; non-blocking.** `evals/lib/scratch.mjs:50` and `:80`; `evals/lib/results.mjs:77`.

The selected provider block is copied wholesale. From Codex config, `secretsOf` collects only base URLs. A synthetic block's made-up `http_headers.Authorization` value was copied, but its token was absent from `secretsOf({}, config)`. The compact-results guard therefore cannot recognize that value if a claim includes it. This is a coverage hole, not an observed leak from this host.

**One-worker fix:** allow-list safe fields and reject unsupported inline credentials, or collect their values for redaction. Add synthetic-header/token regressions. Keep provider URLs in disposable config.

## Nits

None.

## What fits

- Ownership stays in evals, its deterministic tests, the Biome exclusion and prototype README pointer. The fixture stays outside product Vitest/TypeScript scope; no product dependency or bundle changed.
- `cellEnv` assigns scratch homes and filters parent Claude/Cezar/session variables and unrelated credential names. Codex plugin installation uses scratch CODEX_HOME; Claude Code uses scratch HOME. No reviewed runner path explicitly writes the real harness homes.
- The matrix is four tasks × four models × three repetitions, medium effort, 48 sessions. Cell entry rejects Opus/Fable. Both entry points check load before a cell, including a second check in the child. A held probe verified this path.
- By source inspection, T2 warms with the flake off, then restarts with two cold runs; the counter keys scratch path and clock bytes. T3 stops before an outside source edit. T4 stops and sets a nonexistent SQUEAL_CLI only in cell env, which the daemon launcher respects. Live model effects remain unverified here.
- Successful stop discovers cell daemon pids before/after stop, waits and escalates TERM then KILL, with deterministic unit coverage. S2 bounds what this establishes.
- Recorded refused Claude/Codex calls, ordinary bash wrappers, unconditional chains, and fixture heredocs are handled. B2 identifies missing execution cases.
- The claim parser rejects the echoed three-choice template. Normal assertion failures and the uncovered node:test trap are graded in deterministic examples.
- Conditions include fixture, hashed prompts, knobs, variant and effort, excluding observed product/harness/model versions. Trend comparisons stay within a fingerprint; variant runs are excluded; false claims/forbidden edits are listed. The 25-point boundary has deterministic coverage and floating-point tolerance.
- The 005-07 import has 36 cells, nine per model, matching published own-Vitest counts (Haiku/Sonnet/Luna/Sol: 3/3/0/0), zero false claims and forbidden edits. In-memory trend regeneration matched committed TREND.md byte for byte. Preserved prototype quirks are disclosed; the import has a separate conditions line.

## Inputs for the next wave

Fix B1 through B5 before treating evals as trustworthy release/quality evidence. Ownership can stay in evals and test/evals; no product protocol change is needed.

The cleanup row can include S2/S3. The command row must carry action order through parser, timeline and grader. The truth row must persist completion before grading and never synthesize exit 0. The status row must use the pinned CLI's full state contract. The variant row must partition fixture checks by arm before constructing conditions.

Before 006-04, settle S1 or explicitly isolate and uniquely name both runs. A calm-load live proof of T2 to T4 and failure cleanup remains needed. The unrelated full-suite failures also need a coordinator decision or calm independent verification; this reviewer did not repair them.
