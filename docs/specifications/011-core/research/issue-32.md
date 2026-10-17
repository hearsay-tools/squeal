# Issue #32: first-seen failure without a baseline

Date: 2026-10-17. Source: https://github.com/hearsay-tools/squeal/issues/32 (`friction`, agent-reported).

## Fit and owner

Inferred: passes the vision decision filter by making feedback more trustworthy, reducing misleading attribution, and preserving uncertainty across harnesses. Spec 011 Core owns C5 (known state, first-seen failure and delivery wording) and C6 (status and `why` provenance); C4 baseline lookup is related.

## Reproduction verdict

Not reproduced, because the one-minute host load was 36.79 on 24 CPUs, above the explicit reproduction cutoff. No researcher was dispatched, no live probe was run, and no product behavior is claimed verified. A future isolated reproduction appears bounded to about 20 minutes, but existing holds stand.

Read in repository metadata: origin/main package version is 0.1.211; the active Codex Squeal plugin is 0.1.199 (session CLI path). The issue does not name its Squeal version. Neither version was live-tested here.

Exact inspection commands:

```sh
git fetch origin
gh issue view 32 --repo hearsay-tools/squeal --json title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:package.json | head -5
git show origin/main:docs/board.md | rg -n '#32|gh-32|first.observed|predat|test-wait-discipline|ci-wait-refusal|no baseline|provenance'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title
```

Load output: `36.79 29.31 22.03 18/3232 24659`; CPU count: `24`.

## Evidence and duplicates

Reported, not independently verified: after editing `packages/cezar/src/workflows/ci-wait-refusal.test.ts`, the reporter saw a first-observed failure in `packages/cezar/src/test-wait-discipline.test.ts`, whose broad read graph included the edit. The reporter says the same check failed at the base commit, with diagnostics in other files (`server/forge/github-filters.test.ts`, `github.test.ts`).

Read in spec 011 C5: delivery explicitly associates failures with closure paths changed since registration; it states observation revision, but that is not proof of causation or a passing base commit. Inferred: the requested uncertainty is compatible with that factual contract. The suggestion to suppress closure evidence based on diagnostic paths needs a human decision: diagnostic locations need not identify every causal input.

Duplicate verdict: no #32 row or matching symptom/file row on origin/main, and no open issue for missing-baseline attribution. #31 also mentions broad dependent suites but concerns scheduling; #15 concerns missing `why` evidence; #28 concerns changed-failure fingerprints. They are related, not duplicates. Existing `triaged` issues were included in the search; #32 was not yet labelled triaged.

## Human decision and implied done-when

Approve or decline a bounded follow-up for explicit missing-baseline uncertainty. Decide whether to include an explicit, policy-governed command to validate the check at the base commit and whether to retain the factual closure-touch line. No automatic baseline rerun is authorized.

Done when a first-seen failure without a validated base result says it may predate session edits, distinguishes observation from regression, and offers a safe explicit way to settle baseline provenance; coverage distinguishes an absent baseline, a known passing baseline and a known failing baseline, including broad scan tests whose diagnostics name other files. Closure-touch wording follows the approved decision and never asserts causation without evidence.
