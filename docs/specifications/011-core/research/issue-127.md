# Issue 127: load-qualified fast retry queue latency

Date: 2026-10-29. Issue: https://github.com/hearsay-tools/squeal/issues/127

## Verdict and fit

Not reproduced, because the one-minute host load was 69.67 on 24 online CPUs. No researcher or live probe was started. Reported and checkout Squeal versions are both 0.1.377. The report fits the vision: faster relevant feedback, less blocking and honest queued state, with provenance and policy limits intact. Owner: spec 011, C4 scheduling, C5 explicit retries, C6 status and C15 named demand.

## Evidence

**Read in issue (reporter evidence, not independently verified):** an explicit load retry was accepted around 10:24 UTC; recorded load fell below the CPU count by 10:28; the file started at 10:36:17 and passed at unchanged tracked inputs. The retained snapshot has load 11.3 / 24 CPUs, a pending retry and a selection queued behind a 33-file Vitest tier. The receipt text was not retained. The report does not establish that load caused the initial failure, that every intervening tier was unrelated, or that a scheduling contract was broken.

Reported commands (not executed here):

```sh
squeal retry packages/cezar/src/delegation/workspace.test.ts --reason load
squeal status --wait 60000 packages/cezar/src/delegation/workspace.test.ts
```

**Verified by inspection command:** `cat /proc/loadavg` returned `69.67 46.98 35.94 75/2659 2818424`; `getconf _NPROCESSORS_ONLN` returned `24`. `package.json` names 0.1.377. Baseline: origin/main `054ee4b399b07ebd0c9237010a6984b8ec5c7b4c`.

**Read in specification:** C5 queues a qualified retry at its normal priority. Its 600 s bound limits waiting for the load gate, not start time after qualification. C4 governs tier order and interruption. C15 promotes named waits and protects selected running work; C6 reports pending state. A claimed retry and an open load gate do not alone prove that its runner started. No product source experiment was performed.

## Duplicate check

Commands: `git fetch origin`; `git show origin/main:docs/board.md` searched for `#127`, `gh-127`, `retry`, `fast.retry`, `successive`, `workspace.test` and `011-266`; `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` (including triaged issues); `gh issue view 127 --repo hearsay-tools/squeal --json state,title,body,url,labels`.

No existing issue-127 row or exact open duplicate was found. Open, triaged #114 concerns a slow retry receipt claiming an immediate run; #110 concerns named slow-file priority; #125 concerns broad whole-file completion; #116 concerns handover losing demand. Closed #92 / 011-213 supplied the load-gate bound, not a start bound. Closed #51 and #63 are related historical retry reports named by the reporter. Row 011-266 keeps promoted-only fairness questions open; it does not decide explicit load-retry admission.

## Human decision

Approve research and a policy for eligible fast retries at a safe tier boundary, with separate load-gate and scheduler-wait state; or retain normal priority and clarify that no start bound is promised. Define any start bound and backlog fairness before implementation. Do not promise an estimate unsupported by runner evidence. Existing holds stand; no implementation is authorized.

Done when an eligible explicit fast retry starts under the approved boundary and fairness policy, or status explains the known blocker and the absence of a start bound. Evidence must distinguish gate eligibility, admission and start; cover repeated unrelated tiers, selected running work, cancellation, key changes and background fairness; and preserve the failure until a valid pass replaces it.
