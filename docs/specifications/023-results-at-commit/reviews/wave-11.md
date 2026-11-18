# Wave 11: end-to-end repairs

FAIL dc059f5c727d7140c2b1262e431c26b40ff7b28f

One proven blocker: post-run re-keying can replace a failing run with another commit's stored pass. Zero other should-fix findings or nits.

Scope: `cand/0.1.563`, range `98e5ab280c0fdbff24aa6c5c20a32a102f6458c0..dc059f5c727d7140c2b1262e431c26b40ff7b28f`, row 023-18. This review covers D1 through D3 in `tasks/wave-11.md` and N1 in `wave-9-rereview.md`. The earlier review's settled blockers were not reopened. No product code was edited.

## Verification

All code checks and independent probes ran at the exact candidate on a clean tree, before adding this report. The prepared dependency installation was retained, as requested.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD`; `git status --short` | Requested candidate; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3731 files in 1582ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; clean, no bundle drift. |
| Focused Squeal wait below | Exit 0, revision 0: all seven named files current, no known failures, after 12.1 s. Whole worktree: 890 of 1984 files not current, 90 queued and 800 unknown. |
| Affected-source wait below | Exit 3 after 60.7 s, revision 0: 401 selected files, 118 current passes, 49 pending and 234 unknown. Whole worktree: no known failures; 686 of 1984 files not current. Incomplete verification. |
| Repeated affected-source wait | Exit 3 after 60.9 s, still revision 0: 162 current passes, nine pending and 230 unknown of 401 selected. No known failures; incomplete verification. |
| Gate/daemon focused wait | Exit 3 after 60.7 s, revision 0: six current passes, four pending of ten selected. Named below. |
| `timeout 600 pnpm run check:private`, before the report commit | Exit 0: 1684 added lines in 68 candidate files checked. Warning: the private denylist is empty, so its rule was skipped. |
| `timeout 600 pnpm run check:private`, after the findings-only commit | Exit 0; candidate plus report passed. The empty-denylist warning remains. |
| Final `squeal status --wait 60000`, report-only descendant | Exit 0, returned on quiet after 1.5 s at revision 1; the report affects no test file. No known failures; 485 of 1984 files not current (seven queued, 478 unknown). Supplemental evidence, not a complete candidate gate. |
| Independent source-command and bundled-child probes | Six corrected jobs exited 0: `mutate`, `baseline`, `git`, `install`, `notkept`, `budget`. Results below. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44326879818) | In progress at the read before filing. Lint and typecheck steps passed; version-sensitive checks and six test shards had not finished. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44326879732) | Completed successfully at the exact candidate. |

The focused command used the session launcher, written with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/status-at-run-rekey.test.ts test/cli/proof-rekey.test.ts \
  test/cli/status-at-run-not-kept.test.ts test/cli/status-at-run-gitattributes.test.ts \
  test/proof/own-home-budget.test.ts test/keys/key-format.test.ts \
  test/runners/boundaries.test.ts
```

The gate/daemon wait named `test/code/gate/{keep,keep-grown,keep-grown-daemon,keep-daemon}.test.ts`, `test/run-evidence/keeper.test.ts`, and `test/cli/{code-gate-files,code-gate-keep,code-gate-keep-grown-daemon,code-gate-stored,code-gate-files-outcome}.test.ts`, each passed explicitly. The four pending files were the CLI files except `code-gate-files-outcome.test.ts`.

The source wait used that launcher with `status --wait 60000` and these paths: `src/core/code/gate/{keep-reasons,keep,stored}.ts`, `src/core/commit/{at-keys-checkout,at-keys-walk}.ts`, `src/core/proof/own-home.ts`, and `src/cli/{status-at-run,proof-run,code-gate-files,code-gate-stored}.ts` (each path passed explicitly).

Each corrected probe used a Squawk job running `env HOME=/tmp/sq-wave11-bootstrap-home NODE_ENV=test timeout 600 node --import ./node_modules/tsx/dist/loader.mjs --disable-warning=ExperimentalWarning /tmp/sq-wave11-probe.mjs <case>`. The probe imported the candidate's source commands and launched its committed Claude Code CLI bundle for the gate child. Each fixture repository, private HOME and cache was below `$TMPDIR`; no probe used the account HOME. The injected installer linked the candidate's Vitest, as the repository fixtures do. Frozen installation itself was not independently tested. Every completed fixture checked that only its original Git worktree remained, then removed its files.

Initial harness attempts used the unbundled `dist` CLI, which lacks the colocated coverage provider, and then mixed unbundled keying with the bundled child. Those attempts failed harness assertions and are not candidate evidence. Source keying plus the bundled child fixed the harness. No setup install, optional by-hand end-to-end suite, or local full suite was run.

## Blockers

### B1. Proven: re-keying after a test writes an input reads another commit's result as this run's

Locations: `src/cli/status-at-run.ts:156`, `src/core/commit/at-keys-checkout.ts:209`, and the store-first branch in `src/cli/status-at-run-outcome.ts:80`. The same new re-key path is called by `src/cli/proof-run.ts:159`.

Contract: wave 11 D1 requires the state, origin, stored count and key to agree with the result actually kept, and a second `--at` call to agree. Spec D4.7 stores results at the commit's keys. Vision principle 2 forbids an old result posing as current truth.

**Reproduction, with real Git and Vitest:**

Create a two-commit repository with `squeal.config.json` equal to `{}`, a module package, a Vitest include of `test/*.test.ts`, and this identical test at both commits:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
it('value', () => {
  const path = new URL('../data/a.txt', import.meta.url);
  const got = readFileSync(path, 'utf8').trim();
  if (got === '1') writeFileSync(path, '2\n');
  expect(got).toBe('2');
});
```

Commit A holds `data/a.txt` as `1\n`. Commit B holds it as `2\n`; B is HEAD. Use a throwaway HOME and an honest install. Calls:

```sh
squeal status --at B test/a.test.ts --run --all-missing --json
squeal status --at A test/a.test.ts --run --all-missing --json
squeal status --at A test/a.test.ts --json
```

Actual results from the corrected `mutate` job:

| Call | Actual result |
| --- | --- |
| B with `--run` | Test passes; `run.stored: 1`; pass stored at `423337d3…`. |
| A with `--run` | Test reads `1`, writes `2`, and fails its assertion. The report instead exits **0**, says **`pass`**, `run.stored: 1`, `origin.kind: "run"`, `origin.stored: true`, and names A as its origin commit. Its key is **B's `423337d3…`**. |
| A without `--run` | Exits **3**, says **`no result`**, at A's distinct key **`7a0284e0…`**. |

Raw `SELECT * FROM results` snapshots before and after A's run were identical. They held only B's two pass rows, with B's commit and original run ID. The gate did not store A's changed-input run. The failure is the reader: it opens a new keyer on the checkout **after** the test changed it, gets B's key, finds B's old pass, and relabels it as A's successful run. The keeper's refusal cannot help because `outcomesOf` reads any records at that key before considering the gate answer or its not-kept reason.

This also produces a wrong reported key without a stored collision. The collision makes the error a false pass, rather than only a mismatch on the next call. The normal proof control passes, but `proof-run.ts` uses the same post-run key and store-first outcome reader; include that caller in the repair. A separate mutated proof verdict was not executed.

**One-worker repair:** carry each kept file's actual key and run identity from the keeper through the gate answer, preserving project identity, and read back only records certified for that completed outcome. An unkept run must retain its own gate outcome and reason; it must not borrow any result at a key computed from bytes the test changed. If re-keying remains, first prove it still describes the expected commit/side bytes and preserve uncertainty when it does not. Do not use a newest-result lookup by path. Add the two-commit collision regression, assert the actual failure and zero stored count, assert the original store rows stay unchanged, and exercise the proof caller too. Preserve the passing runtime-read regression where inputs remain unchanged.

## What fits

**D1, normal runtime reads:** the independent source-proof fixture read a tracked data file through `fs`, outside its static imports. Its first proof returned `proven`, two runs, red fail and green pass, both `stored: true`, both `notStored: null`. The next call returned `proven` with zero runs and both sides from the store. The red failure retained `expected 1 to be 2`. This confirms the original reported-key defect is repaired for unchanged inputs. B1 is the changed-input boundary that remains.

**D2, reason propagation:** source inspection shows additive reason collection and accessors. No keep decision, queue/write rule, retry, selector or daemon branch changed in `keep.ts`, `stored.ts` or `code-gate-stored.ts`. `NotKept.add` retains its prior aggregation and also records a per-file phrase. `runGateFiles` reads the reasons after the existing keep/close sequence.

The independent absent-`src/package.json` fixture confirmed the behavior: first run passes but stores zero, with `the gate did not keep it: it read paths first seen during the run (src/package.json)`. A lookup finds no result. The next run stores one, and the next lookup reads that pass. A coverage-off control still stores zero and reports `the gate keeps a result only with coverage on`. The new tests also cover proof reason propagation. Thus the reported D2 cause is supported and the storage rule remains intact. Broad gate/daemon verification remains subject to the affected-check limits above.

**D3, checkout classification:** the independent Git fixture held `*.bat text eol=crlf` and an LF `tools/run.bat` blob. JSON named `changedBy: "git"`, at the top level and in `run`; its file said `not comparable`, reason `git's checkout rules changed tools/run.bat`, `ran: "pass"`, and stored zero. A later lookup preserved the reason. An installer-only mutation of the same tracked path instead named `changedBy: "install"` and `install changed the checkout: tools/run.bat`. Both stores had zero result rows. The committed regression test also verifies the text header and absence of the old install blame for the Git conversion.

**N1, budget:** a real 12,000-file kept folder stopped copying after 11 files with `OutOfBudget`, 5.36 ms into a 5 ms copy budget. Validation with an expired deadline stopped before a deep link; validation with time remaining found and refused it. A command whose injected install used up its one-second budget started zero tests, reported red `unknown` with `not run (budget)`, top-level reason `budget`, retained its conditions in the rerun line, and wrote zero result rows. The original hidden HOME file survived. That injected installer deliberately ignored its own timeout, so the 3.63 s total is not a measurement of the normal install bound. A byte copy already in progress remains unbounded, as the worker notes state.

## Next-wave inputs

Dispatch B1 as one repair spanning the gate's kept-outcome boundary and both `status --at --run` and proof readers. Preserve project identity, the actual write key and run provenance. An unstored outcome must never become stored because another run has records at a freshly computed key. Keep the original static-to-observed closure fix, D2's reasons, D3's before-install classification and store-nothing behavior, forced-side non-storage, and N1's single deadline.

The optional end-to-end suite was not repeated. The worker reports one passing seven-case run in `tasks/023-18-notes.md`; that is worker evidence. This review provides no full-suite pass or release approval.
