# Issue 157: an absent function inventory reads as zero

Treat a requested file with no complexity index row as incomplete evidence, while preserving zero for a successfully counted file with no functions.

## Verdict and versions

**Verified by experiment, 0.1.414:** the reported output defect reproduces. A new untracked file with three functions returns only `Complexity: 0 functions in src/new.ts, threshold 20`. JSON returns `available: true`, `functions: []`, `files: []`. A genuinely counted empty file has the same evidence arrays. After counting, the unchanged file lists three functions while still untracked. Committing is not required for counting.

Reported version: **0.1.409**, issue revisions 16 and 22. Tested: packaged CLI **0.1.414**, with the real code pass, SQLite stores and tree-sitter counter from **d3f363054fbe5d30e6e11bf8f212e1ac74d567e1** (package 0.1.414), Node **24.22.1**. The probe controls the revision source and runner-listing fact; it does not run a watcher, daemon or test suite. Coverage is off to isolate inventory. This proves a reachable reporting defect and a listing-gate mechanism, not the cause of the reporter's 25-minute delay.

Host check immediately before the probe: one-minute load **16.22**, **24 CPUs**, 2026-11-07 **22:42:06 Europe/Warsaw** (`21:42:06Z`). The probe was allowed by the task's load gate. Initial local read was 18.55/24; the parent's earlier 12.73/24 is context, not this run's load.

## Questions answered

| Question | Answer, tag and version |
| --- | --- |
| 1. Does a new untracked file read as zero before counting? | Yes, with no qualification in text or JSON. **Verified by experiment, 0.1.414.** |
| 2. Is that distinguishable from a counted empty file? | In the store, yes: absent `files` row versus a row plus a successful zero-function count. In the report's evidence arrays, no. **Verified by experiment, 0.1.414.** |
| 3. Can the function list appear later without changing or committing the file? | Yes: advance the controlled listing from revision 1 to 2 and run the real pass. Three functions appear; Git still lists the file as untracked. **Verified by experiment, 0.1.414.** |
| 4. Which code loses the pending state? | The report enumerates only stored file rows; its freshness and not-judged checks never see an absent row. **Read in source code, 0.1.409 and 0.1.414.** |
| 5. Is this already covered by 015-22, 015-35 or the CRAP issues? | Those cover a stale existing count, registration before the first count, and coverage state for listed functions, respectively. They do not cover this missing inventory. **Read in official docs, spec 015 at d3f363054 (0.1.414).** |
| 6. What caused the original long delay, and did restart or commit clear it? | **Not determined:** no original store, listing history or daemon trace was supplied; both a restart and commit occurred between the reported reads. |

## Experiment

The throwaway [probe](probes/issue-157/reproduce.ts) uses a fresh nested Git repository. It never writes another worktree's stores or changes a hold. The first real pass counts `src/empty.ts` (`export const answer = 42;`). It then adds `src/new.ts` with one outer function and two callbacks at controlled revision 2. The runner listing remains at revision 1 for a pass, then advances to 2. [Raw output](probes/issue-157/result.jsonl) preserves all observations.

**Verified by experiment, 0.1.414:**

| State | Index rows / stored count | CLI result |
| --- | --- | --- |
| Counted empty control | 1 / zero functions, zero parse errors | Zero functions; no reason |
| New source, before pass | 0 / absent | Zero functions; no reason |
| New source, pass held for listing | 0 / absent | Zero functions; no reason |
| Same source, listing caught up | 1 / three functions, zero parse errors | `hook` CC 1, `hook.memo` CC 2, `hook.<anonymous>` CC 1 |
| Counted source edited without another pass | 1 / old three-function count | Zero listed functions **with** `pending: changed since revision 2, not counted yet` |
| Control: file index row, missing count key | 1 / absent | Zero listed functions **with** `not counted yet` |

Every packaged CLI call exited 0; all probe assertions passed. The new file remained untracked after the successful count. The missing-count control uses a deliberately absent counter-version key; it distinguishes that path from an absent file row and is not evidence that normal operation creates that control state.

Exact commands, from the worktree root:

```sh
gh issue view 157 --repo hearsay-tools/squeal
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
pnpm exec tsx docs/specifications/015-coverage-complexity/research/probes/issue-157/reproduce.ts /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs > docs/specifications/015-coverage-complexity/research/probes/issue-157/result.jsonl
git diff squeal--v0.1.409 HEAD -- src/cli/code.ts src/cli/code-report.ts src/core/code/pass/listed.ts
```

Inside the probe, each read is `node --disable-warning=ExperimentalWarning <packaged-cli> code <path>` and the same command with `--json`, with the fixture as `cwd`. It checks untracked status with `git ls-files --others --exclude-standard -- src/new.ts`.

## Source diagnosis and prior work

**Read in source code, 0.1.414; the same bodies in 0.1.409:**

- `src/cli/code-report.ts:308` begins with `code.files.list(worktreeId).filter(...)`. Requested paths filter existing rows; they do not introduce a row for an unindexed file.
- `behindOnDisk` (line 230) only loops over those rows. `notJudged` (line 261) also only loops over them. Its `count === null` branch correctly says `not-counted`, but requires a file row first.
- `src/cli/code.ts:110` renders the header from `report.functions.length`. Lines 53 and 235 only enter the daemon sync/wait path when a reported file has `reason === "pending"`. An absent row produces no such reason, so this path cannot rescue it even with a live daemon. This wait bypass was read, not exercised with a live daemon.
- `src/core/code/pass/listed.ts:141` implements D4's deliberate gate: `held` contains fresh paths with no stored file row while the latest revision is newer than the last successful listing. Those entries are removed from the pass. This prevents counting newly added tests as source. The probe exercised that gate with real counting and controlled listing input.

The three-file comparison against tag `squeal--v0.1.409` (`6edeb3cba35642d8c2f52c5e77e2e41bf4651270`) shows import changes only. Version 0.1.409 was not executed.

**Read in official docs, spec 015 at d3f363054 (0.1.414):** D1 and D4 require a new file to wait for runner discovery. D5 says an uncounted file is pending. D6 requires uncounted files to carry a reason. This is a reporting gap at that boundary, not evidence that the counting gate should be removed. Row 015-22 handles files with an older count and its current probe control works. Row 015-35 handles the worktree's registration summary. The 0.1.408 amendment for 015-104 / #155 supplies pending CRAP for a *listed function*; it cannot describe functions absent from the inventory. #135's coverage wait is likewise separate.

## Recommendation and limits

**Inferred, from the 0.1.414 experiment and source:** triage this as a distinct missing-inventory reporting defect in the path form of `squeal code`. Preserve the useful distinction between an eligible file not yet counted and a successfully counted zero-function file. The deciding tradeoff is honest incomplete evidence while keeping D1's protection against counting tests as source. The existing store distinction and probe prove why bare zero is insufficient; this report proposes no implementation or schema.

Open: why the original project's listing or count was delayed; whether its watcher had recorded the new path at the first query; which of restart, later discovery or another event made it ready. Also not tested: coverage, directory expansion, exclusions, symlinks, the original hook's exact function count, or a live scheduling delay. No full tests ran. Existing holds remain unchanged. No product, board, spec, status or skill files changed.

## Verification

The saved probe and a rerun after formatting both exited 0 with all assertions passed. JSON parsing validated all 10 saved records. `git diff --check` passed. No full suite was requested. Biome's path check skipped the probe because this repository excludes `docs`; stdin checks returned “contents aren't fixed,” so no lint pass is claimed.

`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` with the report and probe paths exited 3: neither has a test closure. The probe's `.gitignore` selected `test/policy/repository-inputs.test.ts`; its first 60-second wait expired while queued for lane quiet. Repeating the same status command for that `.gitignore` exited 0 at revision 8 after 34.5 seconds: the selected test file had a current result and no known failures. The wider worktree still had 529 unknown test files. This is an affected-check result, not a full-suite pass.

## Sources

- [Issue 157](https://github.com/hearsay-tools/squeal/issues/157), fetched with `gh issue view`; the 0.1.409 incident is reported evidence, not independently observed history.
- [Spec 015](../spec.md), D1, D4, D5, D6; [status amendments](../status.md); `docs/board.md` rows 015-22 and 015-35 at d3f363054.
- [Report reader at tested commit](https://github.com/hearsay-tools/squeal/blob/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1/src/cli/code-report.ts), [CLI](https://github.com/hearsay-tools/squeal/blob/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1/src/cli/code.ts), [listing gate](https://github.com/hearsay-tools/squeal/blob/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1/src/core/code/pass/listed.ts); read from the local Git checkout and compared with the 0.1.409 tag.
- Existing source examples, read but not run: `test/code/pass/unlisted.test.ts`, `test/code/delivery/code-pending.test.ts`, `test/code/delivery/code-command.test.ts`.
- [Probe instructions](probes/issue-157/README.md), [script](probes/issue-157/reproduce.ts), [captured run](probes/issue-157/result.jsonl).
