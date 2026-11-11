# Issue 185: edits remain at revision zero as heartbeat lapses

Date: 2026-11-11. Owner: 011 Core, C2 (observation), C6 (status), C9 (lifecycle), C13 (errors), C15 (named waits); C7 is a possible diagnostic seam, not an established cause.

## Verdict

Not reproduced, because the one-minute host load was 61.81 on 24 CPUs. The triage instruction requires skipping live reproduction above CPU count. No researcher or probe was started. Installed launcher reports 0.1.430; the incident also reports 0.1.430. No product, spec, status or skill changes are authorized.

## Evidence

- **Read in issue #185:** Codex edits in a cezarion worktree left revision 0. Two named waits returned without a verdict after 5.4 s and 2.5 s, with two selected files current and two unknown. Heartbeat was 11 s and then 13 s stale while the socket answered. Later JSON showed daemon down, heartbeat age 66,601 ms, revision 0, dirty and dirtyObservedAt null, 459 current and 1,462 unknown files. No database-lock error was captured; restart was not tried. These are reported observations, not a local reproduction.
- **Read in spec:** C2 requires saved content changes to become revisions independently of runner refinement. C6 qualifies stored state when no daemon validates and treats unobserved dirty state as unknown. C9 owns heartbeat and exit evidence; C13 owns failures; C15 owns named waits. Revision-zero inherited results alone cannot prove saved edits were validated.
- **Inferred:** observation freshness and recorded daemon stop/stall evidence need investigation before selecting a fix. The report does not establish a lock, startup stall, watcher defect or exit cause.

## Commands

Triage read-only checks:

```sh
git fetch origin
gh issue view 185 --repo hearsay-tools/squeal --json state,title,body,labels,url
git show origin/main:docs/board.md
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
```

Incident commands (reported; not run here):

```sh
squeal status --wait 1000 packages/cezar/src/home/command.test.ts packages/cezar/src/release/manifests.test.ts packages/cezar/src/server-install/binary-identity.test.ts packages/web/src/lib/product-command-display.test.tsx
# repeated once
squeal status --json
```

## Duplicate check and decision

No existing #185 row or match for its four test paths on origin/main. Open issues, including triaged issues, overlap but do not establish an exact duplicate: #138 / held 011-104 has proven refused revision application under a database lock; #163 concerns an idle exit and hidden recorded reason; #176 concerns startup before request acceptance; #180 concerns freshness between narrow requests and named status; #87 concerns blocked-wait diagnostics. Keep #185 separate until incident evidence links a cause. Existing holds stand, especially 011-104.

Human decision: approve a bounded investigation of unobserved edits and daemon stop/stall evidence, and decide whether to combine its freshness/recovery contract with #180, #163 or #176. No implementation dispatched.

## Landing gate

Main CI 43026358907 failed Node 22 shard 1/3 at test/evals/retry-knobs.test.ts:133: service startup printed an empty port. This is the known rates-service flake already recorded on board row 018-24. Source checks file existence before reading its contents; publication can expose an empty file before write completion (inferred race, not reproduced). This triage changes documentation only and does not claim CI passed.
