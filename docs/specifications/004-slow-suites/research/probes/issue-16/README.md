# Issue #16 probe (throwaway)

This is documentation research, not a product regression test. `run.sh` reuses
`../issue-3-preconditions/fixture/`, unchanged, in a fresh temporary git repository.
It selects only the three slow node:test files with `run --slow --wait 60000`.
The subsequent named-file wait covers all three because the first wait can return
early on news. The fixture has no dependencies; no `node_modules` is created or
committed. Only the built-first control runs the fixture's tiny copy/write build,
never this repository's build.

```sh
SQUEAL_CLI=/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs \
  sh docs/specifications/004-slow-suites/research/probes/issue-16/run.sh
SQUEAL_CLI=/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs \
  MODE=built-first sh docs/specifications/004-slow-suites/research/probes/issue-16/run.sh
```

The script checks one-minute load against `os.availableParallelism()` before
creating anything. Above the CPU count it exits 3. In this investigation the
first command was attempted, output redirected to `missing.txt` then renamed to
`load-gate.txt`; it exited 3 at load 24.17 / 24 CPUs. The control was skipped too.
The live path is **unexecuted**; only the refusal and shell syntax were checked.

If run later, each case uses an isolated HOME, XDG directories and store under
`/tmp/issue16-*`, a clean environment, and one slow file/worker at once. The
inherited fixture sets `slow.maxLoadPerCpu: 1000`; the script's pre-launch gate is
the research load constraint. It cannot reproduce shared-slot contention because
its runtime directory isolates the slot. Every CLI step has a 70-second outer
bound. Cleanup calls `stop`, checks for a remaining daemon and removes the scratch
directory only when none is found; inspect any retained directory if it reports
incomplete cleanup. Never use it to stop another session's daemon.

`issue-16.json` and `issue-3.json` preserve the issue text fetched with:

```sh
gh issue view 16 --repo hearsay-tools/squeal --json number,title,body,url,comments
gh issue view 3 --repo hearsay-tools/squeal --json number,title,body,url
```

Findings and the scope of the skipped reproduction: `../../issue-16.md`.
