# Issue 197: failed-test diagnostics in code-gate reports

Date: 2026-11-12. Issue: https://github.com/hearsay-tools/squeal/issues/197

## Fit and owner

Inferred: passes the vision decision filter, especially principle 7 (actionable failure evidence and retrievable logs). Spec 020 owns the one-shot gate: D3.4 completed and unfinished evidence, D3.5 temporary cleanup, D5 failure/incomplete semantics, and D7 report. Runner adapters supply the underlying evidence; this is not a request to change scheduling.

## Reproduction verdict

Not reproduced, because the one-minute host load was 42.39, above 24 online CPUs. No researcher or live probe was started. The reporter used Squeal 0.1.447; this checkout is 0.1.448. Source inspection is not a reproduction of either the original failures or their lost output.

Exact intake and inspection commands (from the repository root):

```sh
git fetch origin
gh issue view 197 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
head -6 package.json
sed -n '185,212p' src/core/code/gate/collect.ts
sed -n '140,157p' src/core/code/gate/report.ts
rg -n 'failed:|failedTests' src/core/code/gate --glob '*.ts'
git show origin/main:docs/board.md | rg -n '#197|gh-197|#196|gh-196|#173|gh-173|collectEvidence|web-typecheck|diagnostic'
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
```

Verified by intake commands: load averages 42.39, 42.43, 39.72; CPU count 24. Issue remains open, labelled friction and needs-triage at intake.

Read in source code at main `1b2e889da4f7de9425c016abed21f660245a8cdf`: `src/core/code/gate/report.ts:150` represents failed entries as path plus test-name strings. `src/core/code/gate/collect.ts:206` closes adapters and recursively removes the temporary directory in its finally block. These seams support the reported concern; they do not establish which upstream assertion or child-process bytes were available.

Reported in issue, not independently reproduced: `squeal code --base origin/main --json > quality.json` on 0.1.447 exited 3 after its 600-second budget. The node:test run named two failed tests in `packages/cezar/test/unit/web-typecheck.test.ts` but exposed no assertion messages, stacks or child output. Their causes remain unknown. No false pass was reported.

## Duplicate check

Read in board and open issue list, including triaged issues: no existing gh-197 row or exact duplicate. #196 concerns cross-runner starvation and elapsed diagnostics, not retaining assertion evidence. #173/gh-173 concerns daemon global-setup results and retrieval through why --include-logs; it shares the bounded diagnostic-capture concern but has a different result owner and retrieval path. #193 scopes closure/module-hook notes; it does not preserve failed-test errors. Existing holds stand.

## Human decision and done-when

Inferred recommendation: approve a bounded diagnostic addition to the gate report. Decide whether to embed available assertion messages, details and stacks in runs[].failed[], or retain a bounded failed-run artifact and return its path; set byte and retention limits before implementation. Preserve available child stderr or state when upstream did not expose it. Successful-run cleanup remains as specified.

Done when a completed gate that reports a failed test supplies enough available diagnostic evidence to investigate it without another coverage run. Verify completed failures and failures observed before timeout, bounded output and truncation, artifact lifetime if selected, JSON validity, and unchanged failure/incomplete verdicts. No implementation, spec amendment or dispatch is authorized by this triage.
