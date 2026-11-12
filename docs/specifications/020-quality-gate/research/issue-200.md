# Issue 200: stored failure provenance and recovery

## Verdict and fit

Not reproduced, because the one-minute host load was 27.50 on 24 CPUs. The triage instruction requires skipping live reproduction above CPU count. No researcher, gate run, retry, or probe was started.

**Inferred:** This passes the vision decision filter: exposing reused failure evidence and a supported recovery action reduces repeated blocking and preserves provenance across harnesses. Owner: spec 020 D7 and D11.7; related D3.4/D5 (incomplete evidence), D17.3 (retention), and spec 011 C9/C15 (explicit retry and named status). Existing holds stand. This document authorizes no implementation.

## Evidence

**Read in issue #200:** The reporter used Squeal 0.1.457 in a squawk worktree. A node:test failure under reported load about 45/24 CPUs made all 96 changed functions incomplete with `test-failed`. The unchanged second run reused the failed file from `store`, had null duration, and exited 3. The reporter says stderr omitted stored-failure provenance and recovery guidance. An explicit load retry plus a named wait cleared the failure; a third gate passed. This incident was not independently replayed. Current checkout version: 0.1.459 at origin/main `f6129e4e26e20d095bc65db138c5f32698650e64`.

Reporter commands, preserved as evidence rather than commands run in triage:

```sh
squeal code --base origin/main --json --timeout 900
squeal code --base origin/main --json --timeout 900
squeal retry packages/cezar/test/unit/test-env-launcher.test.ts --reason load
squeal status --wait 300000 packages/cezar/test/unit/test-env-launcher.test.ts
squeal code --base origin/main --json --timeout 900
```

**Read in repository documentation:** 020 D11.7 requires keyed store reuse and `runs[].from` provenance. D7 defines the report; neither section defines a stored-failure stderr recovery summary. A reused failure alone does not establish a cache correctness defect. The human must decide diagnostics versus an additional explicit rerun policy; no automatic retry of a real failure is implied.

## Triage commands and duplicate check

Commands run on 2026-11-12:

```sh
git fetch origin
git rebase origin/main
gh issue view 200 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md | rg -n -i 'gh-200|#200|stored failure|stored.*load failure|test-env-launcher|retry-failed'
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
```

Load output: `27.50 23.11 23.93`; CPU count: `24`. These are host observations, not reproduction results.

**Read in board and open issues:** No existing #200 row or exact duplicate, including open `triaged` issues. #197/020-40 concerns failed-test error details and retained logs, not reuse provenance or retry guidance. #127 retains a hold on retry priority; #151 concerns dependency age; #192/020-28 and #201 concern losing completed results under store contention. None is this symptom. The report names an external repository test file, not a Squeal source file.

## Human decision and done-when

Decide whether to approve a stored-failure stderr summary and explicit retry guidance. Treat an optional gate-owned rerun flag as a separate policy choice. Recommend the summary first. It should name the stored failed files and supported commands, qualify load/environment retries, and keep failed evidence incomplete until a current successful run replaces it. Cover stored failures, fresh failures, mixed reuse, successful explicit recovery, and persistent real failures. Do not change retry priority or existing holds.
