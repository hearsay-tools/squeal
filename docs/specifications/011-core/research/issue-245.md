# Issue 245: broad affected backlog exceeds a local gate wait

## Reproduction verdict

Not reproduced, because the one-minute host load was **26.25 on 24 CPUs** at intake on 2026-11-18. The human requires skipping live reproduction above the CPU count. No researcher, probe or test run was started.

## Evidence

- **Read in issue report:** [#245](https://github.com/hearsay-tools/squeal/issues/245), agent-reported friction, names Squeal **0.1.563**, Claude Code and revisions 13–21 in squawk PR #3915. Edits to `workflows/run/*`, `jobs/job.ts` and `packages/contract/src/queued-messages.ts` reportedly queued about 1,190 affected files. Two `npm run prepr` attempts exhausted 120 seconds. After 45 minutes and several revisions, 1,093–1,185 files reportedly remained not current. Focused waits sometimes needed two attempts, with 11–25 second heartbeat lapses. CI reportedly passed. The incident and its claimed cause were not independently verified.
- **Verified by command:** `cat /proc/loadavg` returned `26.25 22.82 20.30`; `getconf _NPROCESSORS_ONLN` returned `24`. This is the triage host load, distinct from the reporter’s approximate 20 on 24 CPUs. No version command ran: 0.1.563 is the reported incident version, not a measured reproduction version.
- **Inferred:** the request passes the vision filter through faster feedback, less repeated blocking and explicit uncertainty, provided a CI handoff remains incomplete local evidence rather than a local pass.

## Commands and limits

Intake commands: `git fetch origin`, `gh issue view 245 --repo hearsay-tools/squeal --json state,title,body,url`, `cat /proc/loadavg`, `getconf _NPROCESSORS_ONLN`.

Reported reproduction commands, **not executed here**:

```sh
npm run prepr
squeal status --wait 60000 workflows/run/cut-off-work.test.ts
```

No probes were created because the load guard stopped reproduction before dispatch. The external `prepr` implementation was not inspected. It must not be assumed to be Squeal’s `code` quality gate.

## Owner and duplicates

**Read in repository docs:** owner **011-core**, C4 (scheduler and validity), C6 (status), C9 (heartbeat/lifecycle), C10 (capacity/policy), C15 (named demand); related **005 D2** (named CLI waits). A CI fallback needs an explicit project policy decision.

Searched `origin/main`’s board for `#245`, `1,200`, `1200`, `local gate`, gate/load symptoms and the reported file names. No existing #245 row or exact matching row was found. Checked open issues using `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels` and `gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title`.

No exact duplicate found. Partial overlaps: #125 broad whole-file gate and safe handoff; #209 directly edited tests in bulk revisions; #241 delayed source consumers; #225 CPU admission; #243 pause-group backlog; #204 broad rebase-triggered queues. These reports do not prove one cause. #125 remains its own human decision after named-wait research. Held priority and lookup-only rules remain unchanged.

## Human decision

Merge the broad-gate demand into gh-125 or keep a separate row, then decide whether to approve diagnosis and a policy for estimates or explicit incomplete CI handoff. Decide separately whether edited-test priority needs a change after comparing gh-209. Missing local results must never become a passing verdict. No implementation or dispatch is authorized by triage.

## Landing check

Main CI run 44403948076 failed only the warm-up slow-load progress uniqueness assertion, expected 2 to be 3. Its output repeated the plain progress count around a load-wait state change. This matches the known failure already recorded in board row 005-82; no repair or rerun was dispatched here. Documentation checks: `git diff --check`; no product tests required for these Markdown-only changes.
