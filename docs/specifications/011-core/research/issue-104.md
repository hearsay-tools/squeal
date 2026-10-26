# Issue 104: validation restarts after a branch fast-forward

Date: 2026-10-26. Issue: https://github.com/hearsay-tools/squeal/issues/104.

## Fit and owner

[inferred] Passes the vision decision filter: an explicit opt-out avoids unread validation and resource use in a coordination session. Spec 011 owns the change: C9 stop and holds, C8 hook ensure, C6 status; C2/C4 observation and queueing and C10 policy are supporting sections. No contract change is approved by this triage.

## Reproduction verdict

Not reproduced, because the one-minute load average was 42.27 on 24 CPUs. No researcher, daemon experiment or probe was started. The user's load rule takes precedence over the reproduction request.

[verified by experiment] Read-only host and version checks in this triage:

```text
cat /proc/loadavg
42.27 42.12 39.76 46/5300 2706911
nproc
24
```

The checkout package.json names Squeal 0.1.349. The session plugin also names 0.1.349. The issue records no incident version or exact output; it names 0.1.345 as current when filed. Those are distinct from a reproduced version.

## Report and contract

[inferred from reporter evidence, not independently verified] The Claude Code coordination session ran `squeal stop` three times. After `git merge --ff-only origin/main`, hooks restarted validation and queued about 138 test files plus an 85-file slow tier. The session wanted no results. Reported load was 28 to 47 on 24 CPUs.

[read in source code: specification] Spec 011 C9 intentionally clears the stopped mark when the tracked-tree fingerprint changes, or on explicit start. It does not distinguish edits made by a file tool from a fast-forward. Command holds survive edits, but keep recording revisions and queueing work; they resume that work when the command ends. This explains why the existing hold does not meet the requested no-queue mode. This is contract evidence, not a live reproduction.

Exact reported sequence, not executed here:

```sh
squeal stop
git merge --ff-only origin/main
```

## Duplicate checks

[verified by experiment] `git fetch origin` completed. Searched `git show origin/main:docs/board.md` for `#104`, stop, hold, fast-forward, session-long and until-start; no existing issue-104 row or exact disable-until-start row was found. The report names no product file. `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` returned 17 open issues, including triaged issues; none other than #104 requests this mode. #105 concerns ignored-file observation, not a durable explicit opt-out. #27 concerns session cleanup.

`gh issue view 22 --repo hearsay-tools/squeal --json state,title` and the same command for #90 confirmed both are closed. #22 / 011-08 deliberately holds only until an edit. #49 / 011-61/011-74 and #90 / 011-211 cover command holds and their guidance. These overlap but do not duplicate a session that queues no validation across git operations.

## Human decision

Approve an opt-in disable-until-start mode, deciding whether its scope is the worktree or one harness session, or retain the current stop and command-hold contracts. The suggested flag names in the issue are proposals only. Existing holds stand. No implementation or spec amendment is authorized.
