# Issue 126: stop after the worktree root is removed

Date: 2026-10-29. Source: [issue #126](https://github.com/hearsay-tools/squeal/issues/126). Documentation-only triage; no implementation authorized.

## Fit and owner

[inferred] Passes the vision decision filter: scoped cleanup reduces agent blocking, preserves process ownership and gives an honest completion result across harnesses. Spec 011 owns it: C9 (daemon shutdown and explicit-root resolution), related C1 (worktree identity and shared store) and C14 (runner child cleanup). Existing holds stand.

## Reproduction verdict

Not reproduced, because the one-minute host load was **96.49**, above **24 CPUs**. No researcher, fixture, daemon or test was started for reproduction. No probes were created. The issue reports Squeal **0.1.377**; this checkout's package.json also records **0.1.377**. The original removed-worktree revision and status JSON were not recorded. The report's approximately 12-second remaining node:test runtime is reporter evidence, not a verified timing bound.

Exact read-only commands used for intake and the load gate:

```sh
git fetch origin
gh issue view 126 --repo hearsay-tools/squeal --json state,title,body,url,labels
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
cat package.json | head -10
cat src/cli/stop.ts
sed -n '/### C9\./,/### C10\./p' docs/specifications/011-core/spec.md
```

Load output: `96.49 64.45 44.79 70/3659 1899809`; CPU output: `24`.

[read in source code] `src/cli/stop.ts`: `stopArgs` calls `explicitRoot` before `daemonSocket`, daemon identity lookup or a stop request. A missing path prints `does not exist; nothing stopped` and returns exit 1. The accepted usage is `squeal stop [--until-start] [root]`; no saved-ID selector exists in this parser. This confirms the refusal path in source, without live reproduction.

[read in source code] C9 and completed row 011-09 deliberately reject missing roots and paths inside another worktree to prevent stopping the enclosing checkout. A recovery mechanism must preserve that protection. Existing shutdown-before-deletion guidance does not resolve recovery after deletion.

## Duplicate check

Commands:

```sh
git show origin/main:docs/board.md | rg -n '#126|gh-126|stop.ts|removed root|root.*remov|shutdown|daemon lifetime'
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue view 2 --json state,title
gh issue view 27 --json state,title
gh issue view 107 --json state,title,body
```

[read in source code] No #126 row or exact symptom row existed on origin/main. Row 011-09 defines the current rejection; 001-436 concerns stop returning before daemon exit, not lookup after root deletion. [inferred] No exact open duplicate, including issues with `triaged`. Closed #2 covers stop before deletion; open #27 / gh-27 concerns session lifetime; open #107 concerns a fixture server surviving an accepted stop while its root still exists. Keep their evidence separate.

## Human decision and done-when

Decide whether to approve recovery through saved repository/worktree identity, or retain the existing stop-before-deletion contract. If approved, choose the identity interface before implementation. No broad process scan or repository-wide kill is requested.

Done when a caller can stop only the removed worktree's owned daemon and test children using saved identity, with an honest stopped/remaining/unknown result. A two-worktree regression must remove A during a test, stop A after deletion and verify B still runs tests. Cover stale or reused identities, an already-exited daemon, and the existing missing-path/enclosing-checkout safety rule. Timing and child termination remain unverified here.
