# Issue 95: node:test runs that outlive their tests

Date: 2026-10-25. Issue: https://github.com/hearsay-tools/squeal/issues/95
Baseline: origin/main `40a2aafbd1c6cf76e9cd9ac84b8519cbb8a66ec1`.

## Fit and owner

Inferred: passes the vision decision filter. Bounded, revision-aware runner feedback reduces blocking and manual process inspection. Spec 003 owns node:test completion and process cleanup (goal 4, D5). Spec 011 C4, C6, C10 and C14 own related scheduling, status, limits and adapter contracts. Existing holds stand. This triage authorizes no implementation or contract amendment.

## Reproduction verdict

Not reproduced, because the one-minute host load was 24.83 on 24 CPUs. No researcher, live fixture or probe was started. The load gate applies even if a small fixture would take less than 20 minutes.

Read in checkout: package.json version 0.1.302. The session plugin also reports 0.1.302. The reporter read 0.1.302 after the incident, but did not record the installed version at the time. That incident version remains uncertain.

Exact host commands and output:

```text
$ uptime
08:07:42 up 10 days, 21:56, 6 users, load average: 24.83, 21.34, 16.19
$ getconf _NPROCESSORS_ONLN
24
```

Reported in issue, not independently verified: `scripts/readme-screenshots.test.mjs` finished its tests but a detached child's open pipes kept its node:test process alive. Two revision-19 runs stayed pending; after a revision-20 PASS an older run and child remained alive. The agent used `squeal status --wait 60000 scripts/readme-screenshots.test.mjs`, `pgrep -af cez-readme-cockpit-`, `kill -KILL -- -1577114` and `ps` to inspect and stop children. The report contains no saved JSON evidence. No incident command was replayed here.

## Contract and uncertainty

Read in spec 003 D5: completion requires process exit, the file wrapper's test:complete and final test:summary. The existing timeout ends groups with SIGTERM then SIGKILL after two seconds. Per-test completion alone does not meet that completion contract. It is unverified whether Node emits the required final events before the leaked child exits in this case. Do not promise early PASS from a presumed last test. A reproduction must distinguish completed test bodies, file completion, hooks, reporter completion and process exit, and retain observed inputs and revision provenance.

Read in spec 011 C4: cancellation and validity are separate; results are current by key, not merely by a larger revision number. Any cleanup rule must identify the superseded run and its owned processes without killing a valid run or unrelated process. C6 owns truthful status; C10 governs bounds; C14 owns the adapter contract.

## Duplicates

Read in origin/main board and open GitHub issue list, including triaged issues: no existing #95 row or exact duplicate. Done 003-38 marks node:test children for the daemon sweep after a tier; it does not establish early completion or cleanup while a tier remains open. Done gh-63 / 011-51 and 001-381 cover superseded-tier scheduling. Open #87 covers blocked revision waits, #43 timeout recovery, #27 session daemon lifetime, and #56 child-loaded inputs. These overlap but do not duplicate this node:test completion and lingering-run report.

Commands used for intake and duplicate checks:

```sh
git fetch origin
gh issue view 95 --repo hearsay-tools/squeal --json state,title,body,url,labels
git show origin/main:docs/board.md | rg -n -i '#95|readme-screenshots|superseded runs|outlives|leaked child'
git show origin/main:docs/board.md | rg -i '#95|readme-screenshots|supersed|leaked child|\bhung\b|\bhang\b|process group'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
```

## Human decision

Decide whether to approve bounded node:test completion diagnostics and cleanup of superseded runs. Set the completion evidence, grace period and safe process ownership boundary before implementation. The issue's suggested event names and early result recording remain proposals, not verified safe behavior.
