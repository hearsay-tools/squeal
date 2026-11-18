# Wave 11 re-review: use the gate's kept key

PASS 444e92c054a057d9750eeb3a7ae684700d89e00f

B1 from `wave-11.md` is closed. Zero blocking findings, should-fix findings or nits remain in this bounded re-review.

Scope: `cand/0.1.563`, repair and bundles in `dc059f5c727d7140c2b1262e431c26b40ff7b28f..444e92c054a057d9750eeb3a7ae684700d89e00f`. The prior findings were read with `git show a30ace7bc:docs/specifications/023-results-at-commit/reviews/wave-11.md`; that report is not yet in this candidate. This review checks B1 and the changed gate boundary, with D2/D3/N1 controls. It does not reopen the earlier settled scope. No product code was edited.

## Verification

The code checks and independent probes ran at the exact candidate on a clean tree, before adding this report. The prepared dependency installation was retained. No setup install, optional by-hand end-to-end suite or local full suite was run.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach 444e92c054a057d9750eeb3a7ae684700d89e00f`; `git rev-parse HEAD`; `git status --short` | Exact candidate; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3732 files in 1639ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; clean, no bundle drift. |
| Focused Squeal command below | Exit 0 at revision 7: all ten named test files current, no known failures, after 37.6 s. Whole worktree: 158 of 1985 files not current, 124 queued and 34 unknown. |
| Affected-source wait below | Exit 3 at revision 7 after 60.6 s: 400 selected files, 363 current passes and 37 pending. No known failures. Whole worktree: 66 of 1985 files not current, 15 running, 22 queued and 29 unknown. Incomplete verification. |
| Repeated affected-source wait | Exit 3 at revision 7 after 60.8 s: 378 current passes and 22 pending of 400 selected. No known failures. Whole worktree: 45 files not current, seven running, 15 queued and 23 unknown. Incomplete verification. |
| Final `squeal status --wait 60000`, report-only descendant | Exit 0 but returned on timeout after 60.6 s at revision 10: 15 affected files pending. No known failures; 30 of 1985 files not current (four running, 11 queued, 15 unknown). Supplemental evidence, not a complete candidate gate. |
| Independent probes | Four final jobs exited 0: `collision`, `variants`, `multi`, `controls`. Real Git repositories, real Vitest, source commands and the candidate's bundled gate child. Details below. |
| `timeout 600 pnpm run check:private`, before the report commit | Exit 0: 1642 added lines in 69 candidate files checked. Warning: the private denylist is empty, so its rule is skipped. |
| `timeout 600 pnpm run check:private`, after the findings-only commit | Exit 0; candidate plus report passed. The empty-denylist warning remains. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44336299001) | Node 24 lint/typecheck/version-sensitive/build job passed. Six Node 22/26 test shards remained in progress at the last read. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44336298819) | Completed successfully at this exact candidate. |

The focused command used the session launcher, written with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/status-at-run-mutated.test.ts test/cli/status-at-run-kept-key.test.ts \
  test/cli/proof-kept-key.test.ts test/cli/status-at-run-not-kept.test.ts \
  test/cli/status-at-run-gitattributes.test.ts test/proof/own-home-budget.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts \
  test/code/gate/keep-count.test.ts test/cli/code-gate-files-outcome.test.ts
```

The affected-source command used the same launcher and wait with these paths, passed explicitly: `src/cli/{code-gate-files,code-gate-stored,status-at-run-outcome,status-at-run,proof-run,proof-side}.ts`, `src/core/code/gate/{keep,stored}.ts`, and `src/core/commit/{at-keys-checkout,at-keys}.ts`.

Each probe job used `env HOME=/tmp/sq-w11r-bootstrap NODE_ENV=test timeout 600 node --import ./node_modules/tsx/dist/loader.mjs --disable-warning=ExperimentalWarning /tmp/sq-w11r-probe.mjs <case>`. Each fixture, private HOME and cache lived below `$TMPDIR`. No probe used the account HOME. The injected installer linked the candidate's Vitest; these checks do not independently validate a frozen package-manager installation. A wrapper imported the committed Claude Code CLI bundle in the gate child's own process, then copied its answer before checkout removal. Every reported kept entry was checked against SQLite result rows joined to their check's project and path. Completed fixtures asserted exactly one remaining Git worktree and removed their files.

Initial probe attempts spawned an extra process between the command and its gate child. The existing parent guard correctly stopped that child. Those launcher failures are not candidate evidence. The corrected wrapper imports the bundle in the same process. An initial unseeded-variant assertion also assumed the keeper would retain nothing; it actually retained the failure at the initial key, and the next lookup agreed. The corrected check verifies agreement with the gate and store instead of imposing that assumption.

## B1: closed

**Proven by the original two-commit collision, a proof variant, and inspection of the changed boundary.**

The original test reads `data/a.txt`, writes `2\n` if it read `1`, then expects the value it read to be `2`. Commit A holds `1\n`; HEAD B holds `2\n`. Both hold the identical test. The corrected `collision` probe first stored B's pass, then ran A, then looked up A without running.

| Step | Actual result |
| --- | --- |
| B with `--run` | Pass stored at `df33d203…`; gate `kept` names that project, path and key; SQLite holds the same rows. |
| A with `--run` | Actual **fail**, `origin.kind: "run"`, `origin.stored: false`, `run.stored: 0`, at A's initial key `d4e3192a…`. Reason: `the gate did not keep it: what its key names changed during the run (data/a.txt)`. Gate answer: `failed`, `kept: []`. |
| A without `--run` | `no result` at the same `d4e3192a…` key. |
| Store before and after A's run | Identical raw result rows: only B's original pass rows and run ID remain. |

The repaired report does not borrow B's pass or B's key. A status comparison containing a known failure still exits 0, as the command's contract requires; it now correctly reports `fail -> pass` from A to B.

The single full proof used the same collision fixture and B's stored pass. It returned `proven` with one run: red failed on `expected '1' to be '2'`, red was unstored, and green came from the store. Red's failure evidence came from its own gate answer. It was not replaced by the stored green outcome.

The `variants` probe also checked:

- With no B result seeded first, the keeper retained the failure at the initial key. The report, gate kept list, SQLite rows and next lookup all agreed on that failure and key. The repair does not change the keeper's decision for this case.
- After seeding B's observed input, a direct `runGateFiles` call with `hostLoad: () => ({ oneMinute: 100, cpus: 1 })` forced the existing load retry without loading the host. The second attempt passed after the first wrote `2`. The gate answered `passed`, `kept: []`, with the changed-input reason, and B's raw result rows stayed unchanged. This supports the worker's note: `--run` preserves that retry behavior, while proof runs disable it. A retry pass is not evidence that the result was stored.

## The kept list matches the write boundary

**Proven by source inspection and independent controls.** `KeptTally.heard` adds entries only from a pass's `kept` files. The existing writer adds a file to that list only after `keepFile` confirms its results write. A coverage-only write, changed input, busy refusal or unknown daemon acknowledgement does not enter that list. The new accessor does not alter the write decisions. Project, path and actual write key survive through `StoredFiles`, `Collected` and `runGateFiles`.

`outcomesOf` now builds its lookup from that list by `testFileId` and reads only the listed key. It falls back to the gate outcome when no kept entry exists, and says the result could not be read back if a confirmed entry has no readable records. It does not infer a stored outcome from arbitrary records at the old or a newly computed key. Proof reads stored failures only when that state says stored, at that state's key. `Rekey`, `rekeyed` and `keyAgain` are removed.

The `multi` fixture ran one path in projects `passes` and `fails`, with distinct setup files and opposite outcomes. It reported two stored files. Its gate kept list named both projects with their distinct keys. SQLite held each project's rows at the corresponding key, and a second `--at` read pass and fail at those same keys. No outcome or failure crossed the project boundary.

A direct gate control kept one completed file and returned its written key. A second direct call read it from the store and returned an empty kept list, correctly describing no new write. The stored results, apart from access timestamps, stayed unchanged.

## D2, D3 and N1 controls

**D2:** a first read of absent `src/package.json` passed but was not kept. The gate returned `kept: []`; the status origin reported `first seen during the run`, and a later lookup had no result. A second run stored one. A coverage-off control returned an empty kept list, zero result rows, `stored: false` and the coverage-off reason. Reason aggregation and the keeper's decisions are unchanged by this repair.

**D3:** an LF tracked batch file with `*.bat text eol=crlf` read `changedBy: "git"` and `git's checkout rules changed tools/run.bat`. An installer-only mutation instead read `changedBy: "install"` and the install reason. Both runs returned `not comparable` with their actual pass shown, `run.stored: 0`, no gate kept list, and zero result rows. The before-install check and store-nothing rule are untouched by the delta.

**N1:** copying a 5,000-file kept HOME tree with an expired deadline threw `OutOfBudget` before copying an entry. Validation with an expired deadline stopped before a deep link; validation with time remaining found and refused it. The original hidden file survived. The focused budget regression passed. The deadline and budget-result code are untouched by this repair; the earlier review's command-level budget mapping remains settled. A byte copy already in progress can still finish after the deadline, as documented.

## Next inputs and limits

No remaining blockers in this bounded re-review. Preserve the gate's per-project write key as the source of truth, the distinction between confirmed and unknown writes, and proof's use of that same key for stored failure evidence. Keep changed and forced checkouts unstored. Preserve the load-retry distinction between status runs and proofs.

Broader affected checks and candidate CI remain incomplete verification, not findings against the repair. The optional end-to-end suite was not repeated. This review provides no full-suite pass or release approval. All independent probe processes exited; disposable probe files were removed before completion.
