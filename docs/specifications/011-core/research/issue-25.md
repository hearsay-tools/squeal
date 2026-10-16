# Issue 25: stop only the explicit root

Date: 2026-10-17. Issue: https://github.com/hearsay-tools/squeal/issues/25.

## Fit and ownership

[inferred] Passes the vision decision filter: preserving another worktree’s validation reduces disruption and keeps filesystem scope explicit across harnesses. Spec 011 Core owns this, C9 (daemon lifecycle and worktree identity), with C1 (per-worktree daemon/shared repository store). No design amendment or implementation is authorized.

## Reproduction verdict

Not reproduced, because the host’s one-minute load was **53.93896484375 on 24 CPUs**, above the human’s limit. No researcher, live daemon experiment or probe was dispatched.

[read in source code] Checkout package.json names Squeal **0.1.203**. The session plugin is **0.1.199**. [inferred from issue report, not independently verified] The reporter used **0.1.199** and says an explicit removed worker path stopped the enclosing main checkout’s daemon. This is reported evidence, not a reproduced result on current main.

Exact read-only commands used for this triage:

```sh
git fetch origin
gh issue view 25 --repo hearsay-tools/squeal --json body,title,url,labels
python3 -c 'import os; print("load",os.getloadavg(),"cpus",os.cpu_count())'
git show origin/main:docs/board.md | rg -n '#25|gh-25|missing (path|worktree)|named root|src/cli/stop.ts|resolveRoot|gh-22|001-436'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue view 2 --repo hearsay-tools/squeal --json title,state,body
```

Reported triggering command (not executed here):

```sh
squeal stop /home/agent/projects/cezar/.ai/cezar/worktrees/ff1cc49a-644c-485e-ad90-bb3474cc518a
```

## Duplicates and human decision

[inferred from board and issue inventory] No existing #25 row, exact symptom row, or other open issue for stopping the enclosing daemon when an explicit root is missing. The board’s src/cli/stop.ts match, 001-436, concerns returning before the selected daemon process exits. Open #22 / gh-22 concerns hook restart after an explicit stop. Closed #2 concerns stopping children before deleting a worktree. These are related lifecycle work, not duplicates of root selection. The open-issue inventory includes the triaged label; #25 was friction-only at inspection.

Human decision: approve strict explicit-root targeting and prioritize it separately from the shutdown and hook-restart work. Acceptance implied by #25: a missing explicit path reports it missing and stops nothing; an existing explicit path with no daemon reports none there and stops nothing; regression coverage protects a running enclosing checkout; no-argument stop retains current-directory resolution. Existing holds stand.

## Documentation verification

`git diff --check` exited 0. No product, spec, status or skill changes. Repository checks were attempted in this dependency-free checkout:

```text
$ npm run lint
sh: 1: biome: not found
(exit 127)
$ npm run typecheck
sh: 1: tsc: not found
(exit 127)
$ npm run build
sh: 1: tsc: not found
(exit 127)
$ node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs" run --all --wait
Checkpoint 7792434b-9f7e-4d77-a7e7-9b97e10d51d1 has no verdict: it was abandoned before every test file had a result
Known failures: 0
(exit 3; no dependencies installed, no test files listed)
```

No passing test claim is made; documentation triage does not establish a product verdict.
