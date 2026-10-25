# Issue 94: daemon startup result under load

Date: 2026-10-25. Issue: https://github.com/hearsay-tools/squeal/issues/94.

## Fit and owner

Inferred: passes the vision decision filter. A reliable startup result reduces false failure reports and preserves uncertainty about daemon readiness. Spec 011 owns this: C9 (daemon lifecycle and explicit start), C6 (status and liveness), and C13 (failure reporting). Spec 010 D12 governs intake only.

## Evidence and reproduction verdict

Not reproduced, because the one-minute host load was 29.24 on 24 CPUs. The human requires skipping live reproduction above the CPU count. No researcher was dispatched, no daemon was stopped or started, and no probes were run.

Reported evidence, not independently reproduced: the agent used Squeal 0.1.301 in Claude Code. After a passing coverage measurement, `squeal start "$PWD"` in an EXIT trap printed `spawned a daemon ... but it did not answer` and exited nonzero. Seconds later a hook reported validation resumed at revision 7, and status showed normal validation. Reported host load was about 40; JSON output was not captured. This caused the passing measurement wrapper to exit 1.

Checkout and session version at intake: 0.1.302. The issue supplies no complete measurement command or exact timing, so this report does not invent them.

Exact read-only commands used for the load and version evidence:

```sh
python3 -c 'import os; print(os.getloadavg(),os.cpu_count())'
# (29.236328125, 26.52783203125, 26.03662109375) 24
git show origin/main:package.json | head -4
# "version": "0.1.302"
sed -n '1,100p' src/cli/start.ts
```

Read in source code: `src/cli/start.ts` contains the reported diagnostic. The command already calls `served` with `SPAWN_WAIT_MS = 10_000` after a spawn and returns 1 if it cannot confirm readiness. This confirms an existing bounded wait and the diagnostic, not the incident or its cause. A proposal must assess that wait rather than assume no polling exists. No live readiness or timeout claim is verified here.

## Duplicate check

Read in repository and GitHub records: fetched origin/main, searched its board for `#94`, `did not answer`, startup, restart, daemon, `squeal start`, and `start.ts`. No existing issue-94 row or exact symptom row was found. The issue names no source files; `src/cli/start.ts` is the source seam found during intake.

Exact GitHub commands:

```sh
gh issue view 94 --repo hearsay-tools/squeal --json state,title,body,labels,url
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue view 1 --repo hearsay-tools/squeal --json title,body
gh issue view 27 --repo hearsay-tools/squeal --json title,body
```

The open list included `triaged` issues. No exact open duplicate was found. Issue #1 concerns daemon loss and store contention; #27 concerns daemons outliving sessions; #90 concerns edits clearing stop and manual resource use. Done 011-111 covers waiting for a spawned daemon to be recorded; done 011-140 and follow-up 011-151 concern version handover. These overlap lifecycle or recovery, not an explicit start returning failure before its daemon answers. No merge with those rows is proposed.

## Human decision

Decide whether to approve revising the existing bounded explicit-start readiness wait and a distinct timeout message that preserves the possibility of ongoing startup and names `squeal status`. Choose the wait bound and timeout exit contract before implementation. A confirmed responding daemon should yield exit 0; a process spawn alone must not prove readiness. Cover delayed readiness under load, genuine startup failure, and timeout with later readiness. Keep hook startup nonblocking. Existing holds stand. This triage authorizes no implementation.
