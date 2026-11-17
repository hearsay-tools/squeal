# Issue #238: lint pending while tests finish

Recommendation: keep a proposed 017 investigation of lint progress and its explanation; the reported 120-second incident is not reproduced by this bounded control.

Examined on 2026-11-18 local time (2026-11-17 UTC), source checkout `629654dde10eb51d1c8698d4d6085b9e61ff17f1`. Installed absolute launcher `~/.codex/plugins/data/squeal-hearsay/bin/squeal --version` returned **0.1.550**. Relevant source files below have no diff from `squeal--v0.1.550`. The fixture used Node **26.13.0**, ESLint **10.13.0**, and oxlint **1.90.0**.

| Question | Answer and evidence |
| --- | --- |
| Can lint remain entirely pending for the reported 120-second gate while tests finish? | **Not reproduced.** The issue reports it; the control had all four lint checks pending through 52.27 s, but two had results by 57.45 s. No clean 120-second gate completed. |
| Was reproduction skipped for host overload? | No. `/proc/loadavg` was 21.41 initially, then 18.46; `getconf _NPROCESSORS_ONLN` returned 24. The corrected fixture started at load 10.68 and its valid observations ranged about 8–11. No extra worktrees or artificial load were created. |
| Did tests finish before lint? | **Verified by experiment, 0.1.550.** The one test file was current while all four lint checks remained pending; a named status wait returned current in 1.3 s. |
| Does aggregate status explain those pending lint checks? | **Verified by experiment, 0.1.550.** It printed `pending:4`, `linting:{done:0,total:4}`, `reasons:[]`. Source shows `reasons` groups unknown states, not queue or capacity waits. |
| Is a selected-file lint gate already available? | **Read in source code, 0.1.550.** Named `status --wait` selects tests. `run <lint group> <paths>` is rejected; a lint group runs whole. Path-filtered `squeal lint` reads details, without requesting or waiting for lint. |

## F1. Incident evidence is a report, not a reproduction

**Inferred from the fetched incident report; reported version 0.1.550.** [Issue #238](https://github.com/hearsay-tools/squeal/issues/238) describes about ten squawk worktrees on 24 CPUs at load 25–90. Its captured aggregate status at revision 6 has 3,457 pending lint checks, zero done and no reasons. Two `prepr` outputs count 6,920 and 6,914 unfinished lint checks after 120 seconds. The [follow-up comment](https://github.com/hearsay-tools/squeal/issues/238#issuecomment-6963889812) says the gate waited for repository-wide lint after five test-file edits. Direct lint reportedly finished quickly and found a real unused import.

These excerpts do not identify which tool or admission stage held the incident's checks. D11 counts `(file, tool)` checks as files, so the roughly doubled counts are consistent with two tools, but that is not proof of this campaign's configuration. The campaign's daemon stores, pool state, gate implementation and installed configs were not inspected. No ten-worktree reproduction was attempted.

## F2. Small live control: delay reproduced, 120-second zero progress not reproduced

**Verified by experiment; Squeal 0.1.550 and tool versions above.** One disposable repository had two `.mjs` files, one node:test test, an unused variable, both lint tools enabled, and the lint group at `edit`. Dependencies were linked from the existing checkout; none were intentionally installed. Complexity and coverage were off. The corrected control explicitly set `baseline.onStart: lookup-then-run-missing`.

| Seconds since start | Test state | Lint state |
| --- | --- | --- |
| 5.74–21.24 | No current test result in snapshots | Four pending; zero done; no reason |
| 26.43–52.27 | One test file current; two passing checks including file-loaded | Four pending; zero done; no reason |
| 57.45–72.97 | Same current test result | Two done, two pending; one lint finding |

The first fixture attempt omitted the baseline setting, so its test was correctly unknown under the default `lookup-only`. It reached two of four lint results by 5.88 s. That attempt is not evidence of tests finishing before lint; it was stopped and replaced, never run beside the corrected fixture.

At about 75 s in the corrected run, a direct comparison used `pnpm exec eslint src/value.mjs test/value.test.mjs` and `pnpm exec oxlint --threads 1 src/value.mjs test/value.test.mjs`. ESLint exited 1 with the expected unused-variable error in 0.46 s; oxlint exited 0 with its unused-variable warning in 0.20 s. **The pnpm command unexpectedly printed `Packages: -447` and changed `node_modules/.pnpm/lock.yaml` through the dependency symlink.** Squeal observed the install change; subsequent fixture results are excluded. The exact installed-package changes were not determined. A root-daemon stopping/heartbeat-current transition was reported by Squeal, but no command stopped or restarted that daemon. The researcher ran no reinstall.

The probe was interrupted at about 104 s; its cleanup stopped only the fixture daemon and returned 0. Thus neither its planned 120-second observation nor its later `run lint --wait 120000` was completed. This is a partial timing control, not proof of a 120-second stall or of the incident's cause. Its no-commit repository, no registered harness consumer, linked dependencies and smaller program also limit comparison with the campaign.

**Inferred from the coordinator's cleanup report, after this experiment:** the parent restored the damaged dependency installation with `pnpm install --frozen-lockfile` at the checkout root: 110 ms, 321 packages reused and added, no downloads, tracked files unchanged. The researcher did not run that restoration. The retained script is disabled to prevent replay with the unsafe dependency link.

## F3. Scheduling and status explain why this is plausible, not why it happened

**Read in source code; 0.1.550.** `src/core/lint/pass/parts.ts` lines 120–123 and 252–259 take a pool slot before a part; a refusal leaves it pending and schedules a capacity recheck. Edit parts use `capacity.running(1)`; first-pass/config backlog uses `capacity.take(1, "slow", 1, "backlog")`. This matches 017 D7 and 011 C10. An edit test's ability to run therefore does not establish that a first lint pass has received capacity. No pool-refusal trace was collected here, so capacity starvation remains **inferred**, not proven.

**Read in source code; 0.1.550.** `src/core/lint/surface/snapshot.ts`, `countsOf`, counts only `unknown` states into `reasons`; `progressOf` derives done/total from stored states. Those counts are not a queue/running-stage diagnostic. D3/D9 timeouts concern an executing provider, and do not impose a deadline on waiting for admission. D8 has no general promise that lint finishes in 120 s.

**Read in source code; 0.1.550.** `src/cli/run-group.ts` lines 75–79 explicitly rejects paths for a lint group. 011 C4/C6/C15 test discovery and named-demand rules do not supply a corresponding selected-lint wait. The issue's selected-files proposal therefore requires a product decision, separate from investigating delayed first-pass lint.

## Commands, sources and remaining question

The retained [probe record](probes/issue-238/README.md) and guarded [script](probes/issue-238/probe.py) list the fixture and actual commands. Reads used `gh issue view 238 --repo hearsay-tools/squeal --json number,title,body,comments,url,createdAt`, the installed launcher's `--version` and help, `/proc/loadavg`, `getconf _NPROCESSORS_ONLN`, the 017 spec/status, and 011 scheduling/status sections and amendments. No full suite, unrelated daemon restart, or product edit was performed.

The owning sections are **017 D2/D3/D7/D8/D9/D11**, with **011 C4/C6/C10/C15** for scheduling/status interactions. [gh-140's research](issue-140.md) concerns oxlint discovery timeout; [gh-181's research](../../011-core/research/issue-181.md) concerns named waits behind test discovery. Neither establishes this incident's cause.

The next approved investigation needs one affected daemon's per-tool phase and pool-wait evidence during the bounded gate. Until then, distinguish delayed execution, provider/discovery trouble, and a repository-wide gate scope. Whether any selected-lint completion guarantee should be added remains the human's decision.
