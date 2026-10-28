# Issue 119: throwaway probes

These are research fixtures, not product code or regression tests. No dependencies
are installed here. Do not commit `node_modules`, fixture stores or sockets.

Initial host reading, before inspection or probes: 2026-10-28 11:44:23 UTC,
one-minute load **19.96533203125**, **24 CPUs** (`os.getloadavg()[0]`,
`os.cpu_count()` in Python). Each probe also checks load before it starts and
exits 77 without running if it exceeds the CPU count.

Tested checkout: `9e4206a2d72738d6964b955aa0dc7073796f4d15`, Squeal **0.1.370**,
Node **v24.22.1**, Linux. The issue reports **0.1.369**, which was not executed.
The committed Claude Code bundle is used as-is. No build or repository suite runs.

Run from the worktree root:

```sh
pnpm exec tsx research/probes/issue-119/probe.ts > research/probes/issue-119/protocol-results.jsonl 2>&1
python3 research/probes/issue-119/live.py > research/probes/issue-119/live-results.jsonl 2>&1
python3 research/probes/issue-119/live.py --edit > research/probes/issue-119/live-edit-results.jsonl 2>&1
```

All three commands exited **0**. Their records contain exact child argv, elapsed
milliseconds, exit codes, stdout and stderr. The protocol driver took about 21 s;
the live drivers each finished in less than 20 s.

`probe.ts` runs the real bundled CLI against a scripted Unix socket and a real
SQLite store created with the checkout's store API. It seeds two pending files.
One scenario answers request acceptance after 12 s, and writes fast and slow
results after 14 and 16 s. The CLI returns before acceptance; a named wait then
observes the slow result. A control accepts at once and writes results after 2
and 4 s. These timers model state changes; they do not run a test runner or prove
what blocked the incident's scheduler. Both scenarios assert their outcomes.

`live.py` starts a real daemon in a new Git repository, with two node:test files,
a private store and `XDG_RUNTIME_DIR`. The fast file sleeps 12 s and the slow file
sleeps 1 s. It starts the CLI once a marker proves the fast file is running.
`--edit` first settles the tiny baseline, then edits both files and waits for the
edited fast file to start. Status before each request records which work is
pending. Each driver stops only its own daemon and removes only its own fixture.
The ordinary case may stop its still-running fast baseline during cleanup.
No hold is cleared. No shared daemon is stopped or reconfigured.

The probe files are outside Squeal's test coverage. Their direct executions above
are the verification. Squeal's untested/CRAP notices for these throwaway files are
not claims that the fixtures failed.

Final affected check:

```text
$ /home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-119/probe.ts research/probes/issue-119/live.py
Revision: 17 · 9e4206a2 + 17, dirty
No verdict: no test file's closure holds research/probes/issue-119/probe.ts; no test file's closure holds research/probes/issue-119/live.py. Worktree: known failures 0; not current: 1290 of 1314 test files (1290 unknown)
```

Exit **3**, as expected for files outside covered test closures. No repository
suite pass is claimed. `git diff --check` passed; report links and JSONL parsing
were checked directly.
