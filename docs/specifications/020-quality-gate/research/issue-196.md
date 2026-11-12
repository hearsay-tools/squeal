# Issue 196: one runner consumes the code-gate budget

## Verdict

Not reproduced, because the one-minute host load was 65.35 on 24 online CPUs. The triage instruction requires skipping live reproduction above the CPU count. No researcher or probe was started. No tests ran for this documentation-only triage.

## Evidence

- **Read in issue:** [#196](https://github.com/hearsay-tools/squeal/issues/196) reports Squeal 0.1.443, command `squeal code --base origin/main --json`, at Squawk commit `5f795150e8cd0083f3c3a6936a0fa7bbf4283cd9`. It selected 6 node:test files and 1,233 Vitest files. Five node:test records and one Vitest record came from stores.
- **Read in issue:** `packages/cezar/test/unit/test-env-launcher.test.ts` consumed the remaining 431 seconds. The report says `timedOut: true`, verdict `incomplete`, 5 passing functions, 50 incomplete functions and no violations; exit 3. No new Vitest file started. The reporter recorded load 57.00/35.29/24.43 afterward. A 3,600-second retry was still running when reported; its final outcome is unknown.
- **Verified by command:** `cat /proc/loadavg` returned `65.35 54.35 56.86 51/4804 2402586`; `getconf _NPROCESSORS_ONLN` returned `24`. Session runtime is 0.1.447, from the registered runtime path; no live gate was run on it.
- **Read in spec:** 020 D3 uses one total deadline; D5 and D7 preserve incomplete evidence. D17 estimates cost and keeps completed records. D18 runs runners sequentially in ascending estimated cost. Row 020-19 shipped this order in 0.1.435 and covers quick node:test work ahead of slow Vitest work.
- **Inferred:** the reported order is consistent with D18 (207 s node:test estimate before 2,114 s Vitest estimate). Estimate order alone cannot prevent starvation when the first runner exceeds the remaining budget. This does not establish why the test was slow or whether its process leaked.

## Fit and duplicates

Passes the vision filter: useful bounded feedback reduces blocking while preserving provenance and uncertainty. Owner: spec 020 D3/D5/D7/D17/D18; runner lifecycle is related only if a separate cause is proven.

Commands used for intake and duplicate checks:

```sh
git fetch origin
gh issue view 196 --repo hearsay-tools/squeal --json state,title,body,url,labels
git show origin/main:docs/board.md
rg -n '196|node:test|budget|code gate' /tmp/issue196-board.md
rg -n '020-19|gh-196|test-env-launcher' /tmp/issue196-board.md
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title
gh issue view 95 --repo hearsay-tools/squeal --json title,body
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
```

No existing #196 row or named launcher-file row was found. No exact open duplicate was found, including the triaged set. Closed #187 and completed 020-19 cover the same cross-runner starvation theme in the opposite direction. Closed #175 owns wide-selection cost and retention. Open triaged #125 concerns a foreground named-test gate; open triaged #95 concerns tests completing while their process stays alive. Neither proves this issue's cause. Retain the completed 020-19 contract; do not reopen or widen it silently.

## Human decision

Decide whether to approve a bounded study of progress across runners beyond estimate ordering, including early active-file and elapsed-time diagnostics. Choose the scheduling contract only after evidence; interleaving is a suggestion, not an approved design. Preserve the unfiltered report required by the reporting repository. Unfinished selected loaders must remain incomplete. Existing holds stand; this triage authorizes no implementation.
