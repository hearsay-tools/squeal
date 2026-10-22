# Issue 76: retry before discovery

Date: 2026-10-22. Issue: https://github.com/hearsay-tools/squeal/issues/76.

## Verdict

Not reproduced, because the one-minute host load was 25.19 on 24 CPUs at the reproduction decision. No live probe or researcher started. An earlier intake sample was 22.17; the later sample governed whether to start. No experiment result is claimed.

## Reported evidence

**Read in issue #76:** the reporter used Squeal 0.1.265 (Claude Code 0.1.264 and Codex 0.1.263 installed) in hearsay-tools/cezarion at base `73cbdfe1f3242b1a6019b2eed61bc5fc75a942fc`. They added `packages/web/e2e/session-footer.e2e.ts` to a registered revision-0 worktree, then ran:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal retry packages/web/e2e/session-footer.e2e.ts
```

It exited 1: `Not retried: packages/web/e2e/session-footer.e2e.ts is not a test file Squeal has keyed in this worktree.` The next report listed the file at revision 1 among 83 pending slow files. A later retry recognized it and named `squeal status --wait 60000 <file>`. These are the reporter's observations, not a local reproduction.

## Local intake commands

```sh
git fetch origin
gh issue view 76 --repo hearsay-tools/squeal --json state,title,body,url,labels
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
```

The governing load output started `25.19 20.37 21.42`; CPU output was `24`. Checkout package version: 0.1.266, read from `package.json`. The session reported a daemon handover from 0.1.265 to 0.1.266. No CLI version or daemon reproduction probe was run.

## Fit, owner and duplicates

**Inferred from the vision:** passes the decision filter. Separating pending discovery from invalid input improves trustworthy state and removes a failed agent step. It preserves uncertainty and the harness-independent pull interface.

**Read in spec 011:** C4 owns listing new files, C5 owns retry of unknown or never-run files, C6 owns status, and C15 requires listing before running a tier and names the next step. Related CLI surface: spec 005 D2. The owner is spec 011 core.

Duplicate checks used:

```sh
git show origin/main:docs/board.md | rg -i '#76|retry|discovery|keyed'
git show origin/main:docs/board.md | rg -i 'session-footer|packages/web/e2e'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
```

**Read in the board and issue list:** no exact duplicate, including open issues with `triaged`. 011-16 / closed #36 handles a file already keyed with no result. 011-27 supplies next commands. gh-59 / 011-63 addresses mixed matched and unmatched named selections. Open #53 covers removed projects; #52 covers load retries. None records this new-file discovery window.

## Human decision

Approve a bounded discovery wait or an explicit pending-discovery reply, or leave the proposal held. Keep missing and out-of-pattern paths distinct. No implementation is authorized. Existing holds stand.

## Documentation verification

`git diff --check`: exit 0.
`npm run lint`: exit 0, `Checked 1770 files in 696ms. No fixes applied.`
`npm run typecheck`: exit 0.
`npm run build`: exit 0; no tracked bundle drift.
`"/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal" run --all --wait`: exit 3, `No verdict: no daemon running`; fallback ran under the full-run lock as `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. This is repository verification, not issue reproduction.

Fallback exit 0:

```text
 Test Files  911 passed | 2 skipped (913)
      Tests  7770 passed | 11 skipped (7781)
   Duration  1165.25s (tests 97%, import 2%)
```
