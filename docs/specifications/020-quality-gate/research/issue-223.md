# Issue 223: stored-failure notice before gate execution

Date: 2026-11-15. Issue: https://github.com/hearsay-tools/squeal/issues/223

## Fit and owner

Inferred: passes the vision decision filter. Earlier actionable evidence can avoid unnecessary blocking and validation cost while keeping failure provenance. Spec 020 owns this: D3.4 (rerun policy and budget), D5 (selected failures block), D7 (report and closing hint), D11.7 (stored evidence reuse), D17.3 (keyed retention). No spec or policy change is authorized by this triage.

## Reproduction

Not reproduced, because the host one-minute load was 31.56 on 24 CPUs. The human requires skipping live reproduction above the CPU count. No researcher, probe or gate run was started.

Verified by host commands on this triage session:

```text
cat /proc/loadavg
31.56 28.01 26.80 33/3321 2233519
getconf _NPROCESSORS_ONLN
24
```

Reported Squeal version: 0.1.506. Session runtime: 0.1.506 (session registration). Checkout package version: 0.1.511 (`cat package.json`). These are distinct; no live behavior was verified here.

Issue evidence, reported by the agent and not independently reproduced: `squeal code --base origin/main --json --timeout 6000` selected 755 files and spent about 26 minutes before exit 3, with 44 functions incomplete. A stored failure in `packages/cezar/src/artifacts/cli.test.ts` did not run locally. The closing hint named `--rerun-stored-failures`. The file passed 6/6 alone; a later flagged gate passed 50/50 functions. Reported host load was 45–90 on 24 CPUs. A pass alone does not prove load caused the earlier failure.

## Existing contract

Read in specification: D11.7 reuses keyed stored results. D3.4 reruns stored failures only with the explicit flag, after first runs and load reruns, within the remaining budget. D7 explicitly puts the stored-failure hint after the verdict. D5 makes every selected failure block a pass; violations take precedence over incomplete. Thus the report supports a known barrier to passing, not a claim that every possible final verdict is necessarily incomplete.

Inferred: the request changes the timing and possibly the default policy, beyond the existing closing hint. Whether all needed stored-failure evidence is available before the first test starts, and the implementation seam for that check, remain unverified.

## Duplicate check

Commands: `git show origin/main:docs/board.md | rg -n '#223|stored.fail|rerun-stored|#200|#214'`, plus a search for `artifacts/cli.test.ts`; `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels`; focused open searches for `stored` and for `failure` with `--label triaged`.

No existing #223 row or exact open duplicate found, including triaged issues. Closed #200 and #214 supplied row 020-60, shipped in 0.1.495: explicit reruns and closing guidance. Open #222 concerns stored failures while daemon retries are pending; #216 concerns broader load and interruption recovery. They overlap but do not ask for the pre-execution notice and early action in #223. Held #127 retry priority remains separate.

## Human decision and done when

Choose early exit with the existing recovery command, bounded automatic rerun of stored failures, or an early notice while keeping full collection. Early notice alone leaves the reported wasted-run cost. Any approved behavior must name selected stored failures before tests start, keep JSON stdout valid, preserve keyed validity and failure provenance, and keep persistent or unfinished required evidence from passing. Cover no stored failure, stored pass, persistent failure, successful rerun and exhausted budget. An early exit must honestly distinguish tests not run from completed evidence and must explicitly settle exit/report precedence. Existing holds stand; no implementation is dispatched.
