# Issue 37: redundant node:test inputs advice

Date: 2026-10-19. Issue: https://github.com/hearsay-tools/squeal/issues/37

## Verdict

Not reproduced, because the one-minute host load was 32.2080078125, above 24 CPUs. No live probe or researcher was started, as required by the triage load guard. No test or product code changed.

## Evidence

- **Read in issue (reporter evidence, not independently verified):** Squeal 0.1.199 in a cezarion worktree printed `declare it in inputs` for `.github/scripts/nightly.workflow.test.cjs`, `release.workflow.test.cjs`, `ci.workflow.test.cjs`, `issue-template.test.cjs` and others despite a matching `.github/scripts/*.test.cjs` inputs entry covering `.github/workflows/**` and `.github/scripts/**`. The reporter duplicated validation with `node --test` and says the note repeats per revision. No inference that invalidation actually failed is justified by this report.
- **Read in repository documentation:** Spec 003 D3 includes matching policy inputs in the closure and treats file reads as declared inputs; D5 describes the bare-closure note. Existing planned row 001-365 already records this exact symptom from 005-18/005-50. This is additional evidence for that row, not a new implementation task.
- **Verified by command:** checkout package version is 0.1.221; session-installed plugin is 0.1.199. The load command returned `(32.2080078125, 19.2158203125, 14.6513671875)` and 24 CPUs. No reproduction commands were run, so current-version behaviour and the original workflow edit's invalidation remain unverified.

## Exact intake commands

```sh
git fetch origin
gh issue view 37 --repo hearsay-tools/squeal --json state,title,body,url,labels
python3 -c 'import os; print("load",os.getloadavg(),"CPUs",os.cpu_count())'
git show origin/main:docs/board.md | rg -n '#37|bareNote|loaded nothing|nightly.workflow|release.workflow|ci.workflow|issue-template|001-365'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title
```

## Fit, ownership and decision

Passes the vision filter: accurate advice reduces noise and unnecessary blocking while preserving uncertainty. Spec 003 D3/D5 owns the runner note, despite intake's area-core label. Exact board duplicate: 001-365; related completed 005-50 filed that row. No separate open issue on this symptom found, including issues labelled triaged.

Human decision: approve existing 001-365 and choose silent suppression for matching declarations or qualified coverage wording. A declaration must not be presented as proof that every runtime read is covered. Preserve actionable advice for files without declared inputs. Existing holds stand; this triage authorizes no implementation.
