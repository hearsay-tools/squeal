# Issue 273: new named tests during pending listing

## Verdict

Not reproduced, because the one-minute host load was 28.80 on 16 CPUs. The human explicitly required skipping live reproduction above the CPU count. No researcher, probe, test run or daemon restart was started. No implementation is authorized; existing holds stand.

## Evidence

- **Read in issue:** [#273](https://github.com/hearsay-tools/squeal/issues/273) reports Squeal 0.1.610 in Codex. This triage checkout and session runtime are 0.1.611. No live behavior on 0.1.611 was tested.
- **Verified by command:** `cat /proc/loadavg` returned `28.80 28.57 26.93 31/2576 3269512`; `getconf _NPROCESSORS_ONLN` returned `16`.
- **Read in issue:** the exact reported command was:

```text
squeal status --wait 1000 packages/cezar/src/workflows/plugin-step.test.ts packages/cezar/src/workflows/step-kind-registry.test.ts packages/contract/src/plugin-steps.test.ts packages/web/src/routes/task-thread/step-rail.test.tsx
```

At revision 3, two new test paths were called “Not a listed test file” and selected at least 105 and 103 readers. The verdict said the revision was not listed yet. Revision-3 JSON was not saved. Follow-up revision-11 JSON reported 685 current and 1430 pending test files, refined revision 10, a pending runner part and Vitest/node:test listing. These are reporter observations, not an independent reproduction. The text does not establish that the status request itself queued or ran those readers.

## Fit and owner

**Inferred:** passes the vision decision filter by improving relevant feedback, preserving discovery uncertainty and reducing unrelated selection. Spec 011 owns C2 (revision refinement and listing), C6 (honest status) and C15 (named selection and demand). A repair must preserve genuine source-path selection and runner authority over membership.

## Duplicate check

Checked origin/main after `git fetch origin`: `docs/board.md` has no #273 row and no match for the two new test filenames. Searched the board for pending listing, unlisted source inputs and the reported classification. Checked `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels`, including issues labelled `triaged`, and read #142, #161 and #229.

**Inferred:** no exact duplicate found. #142 / gh-142 is the closest overlap: new paths are called unmatched while discovery is pending. #273 adds broad reverse-dependency selection during that interval. #161 concerns a committed included file remaining unlisted without pending discovery; #229 concerns rebase-added files remaining unlisted until restart. Done row 015-52 concerns complexity analysis classifying tests as source, a different consumer. No root cause is established here.

## Human decision

Decide whether to merge this evidence and the pending-listing selection requirement into gh-142, or approve a separate bounded selection repair. Require text and JSON to retain an honest pending/no-verdict state until runner membership is known, then return each included named test’s own result. Cover mixed existing/new tests, completed exclusions and ordinary source paths. Keep all existing holds.
