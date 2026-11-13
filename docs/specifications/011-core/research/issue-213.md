# Issue 213: earlier failures after an input edit

Date: 2026-11-13. Owner: 011 Core. Source: [#213](https://github.com/hearsay-tools/squeal/issues/213).

## Verdict and evidence

**Not reproduced, because** the one-minute host load was 100.74 on 24 CPUs. The triage brief requires skipping live reproduction above the CPU count. No researcher, live test, probe or full suite was started.

- **Read in issue report:** installed Squeal 0.1.467 reported six failures from revision 4 of `packages/cezar/src/preview/browser-launch.test.ts` after a later edit to that file. The reporter says a direct run passed, while Squeal's rerun stayed queued. A change to `packages/cezar/vitest.setup.ts` queued about 1,300 files at load 140–175. The repository's `npm run prepr` gate treated the stored failures as known failures. This is reported evidence, not an independent reproduction.
- **Verified by command:** `uptime` returned `load average: 100.74, 97.82, 95.17`; `getconf _NPROCESSORS_ONLN` returned `24`. The checkout's `package.json` is 0.1.471; it was not used for a reproduction.
- **Read in specification:** 011 C3 keys results by input content, with revision as provenance only. C4/C5 define validity and known states. C6 requires the Known failures headline to count current failures only and separate earlier pending/stale failures. An older revision alone does not make a result stale when its key is unchanged. C6 also defines `squeal failures` as a stored-failure history, including replaced failures; appearing in that list alone does not prove current validity.
- **Inferred:** the investigation must distinguish a stale stored failure shown without current-validity information from a daemon that has not applied the input edit, and from a status-count regression. The report does not include the current key, listed revision or status JSON needed to distinguish them. No product defect or root cause is independently confirmed here. A direct external pass does not establish that Squeal stored a replacement pass.

## Commands

Intake and evidence reads, from the repository root:

```sh
git fetch origin
gh issue view 213 --repo hearsay-tools/squeal --json state,title,body,labels,url
git show origin/main:docs/board.md
uptime
getconf _NPROCESSORS_ONLN
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --state open --label triaged --limit 100 --json number,title
gh issue view 34 --json state,title,url
gh issue view 200 --json body --jq .body
gh issue view 212 --json body --jq .body
```

Board searches covered `#213`, `gh-213`, `Known failures`, stale failures, `browser-launch` and `vitest.setup`. No issue-213 probe commands ran. The reporter's commands were:

```sh
squeal failures
npm run prepr
squeal run tests packages/cezar/src/preview/browser-launch.test.ts --wait 580000
```

The report does not give the exact direct-test command or the edit that fixed the test.

## Fit and duplicates

**Inferred:** passes the vision's decision filter: trustworthy current state, fewer false blocks, preserved provenance and uncertainty, shared core behavior across harnesses. Owner 011 C3/C4/C5/C6; C15 is related to the queued named rerun, not a request to change scheduling.

No existing #213 row or exact open duplicate was found. Closed #34, implemented by done row 011-15, covers the same current-only headline rule and is a regression reference. It does not settle whether the stored-failure history exposes enough validity information for a gate. Open #200 concerns reuse at unchanged inputs in the code gate; #212 concerns shared-setup selection size; #209 concerns queue order. These are related, not duplicates of changed-input failure classification.

## Human decision

Decide whether to approve a bounded 011 investigation and repair: expose current versus earlier/pending/stale validity in `squeal failures` for gate consumers, and verify that status counts obey the existing current-only rule after an input edit. Keep historical failures visible with provenance. Do not make a stale or pending result a pass, and do not mark unchanged-key failures stale merely because the revision advanced. Existing holds stand. This triage authorizes no implementation.

Done when a failing file edited to new inputs, with its rerun held queued, has its earlier failure clearly identified in text and JSON and excluded from current-failure counts; a gate can distinguish it from a current failure while validation remains incomplete. Unchanged-key failures stay current; a later stored pass closes the failure with provenance intact.
