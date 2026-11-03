# Issue 139: throwaway scheduler probe

Research only. This is not a product test or a live cezarion reproduction.
`probe.ts` uses Squeal's real scheduler, store, state sink, capacity pool and
status reason functions. A scripted adapter gives five files two lane names.
A promise holds the node-test lane. No Vitest instance, node:test child,
daemon, socket server or shared user pool starts. Each scenario creates and
removes its own Git repository, SQLite store and pool below `.scratch/`.
No `node_modules` belongs in git.

Three scenarios:

1. No capacity pool: four Vitest-lane files settle beside the held node file.
2. One pool slot: the node file holds it; four Vitest-lane files remain queued
   across a 2.2 s observation window and print the fallback reason. Releasing
   the node run lets all five settle.
3. Same capacity wait, then edit one Vitest file: an ungranted edit tier starts
   beside the held node file. In this fixture all four Vitest files share it.

The script checks the real one-minute host load against online CPUs before
starting any scenario. Exit 77 means skipped. Each condition has an 8 s bound;
the shell bounds the entire run to 45 s. The runner hold is released in
`finally`. The fake runner reports passes; these establish scheduler progress,
not application correctness. It does not exercise the CLI wait or the original
revision-2 selection. Absolute paths and timestamps in the JSONL files are
from this research run, not the reported incident.

Historical exact commands, from the researcher worktree root (before integration moved the probes under `docs/specifications/011-core/research/probes/issue-139/`):

```sh
timeout 45s pnpm exec tsx research/probes/issue-139/probe.ts > research/probes/issue-139/current.jsonl 2> research/probes/issue-139/current.stderr
mkdir -p research/probes/issue-139/.scratch/source-0.1.390
git archive squeal--v0.1.390 src package.json | tar -x -C research/probes/issue-139/.scratch/source-0.1.390
ln -s ../../../../../node_modules research/probes/issue-139/.scratch/source-0.1.390/node_modules
timeout 45s pnpm exec tsx research/probes/issue-139/probe.ts research/probes/issue-139/.scratch/source-0.1.390 > research/probes/issue-139/v0.1.390.jsonl 2> research/probes/issue-139/v0.1.390.stderr
```

Both final runs exited 0, printed `PASS` for all three scenarios, and wrote
empty stderr. `current.jsonl` was renamed to `v0.1.393.jsonl`; empty stderr
files were removed. The installed dependency tree was reused for both source
versions. No install or build ran.

An initial harness run exited 1 because it expected the pool mark's `since`
to be non-null. This was a probe assumption, not a product failure: a daemon
already holding its whole share can have `since: null` while its next tier is
refused. The corrected probe waits for `grant: 1`, checks the queue, and keeps
the node run held across a capacity recheck. The final logs record
`want: 5`, `grant: 1`, `waiting: false` in that case.

Final repository verification: the research paths had no test closure; the
unqualified 60 s wait timed out with the repository-inputs test queued (saved
in `verification.txt` and `affected-status.txt`). The later named command
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/policy/repository-inputs.test.ts`
exited 0 after 32.5 s at revision 20: selected file current, no known failures,
all 1,385 test files current. No full-suite checkpoint was requested.

To repeat after integration, replace each `research/probes/issue-139/` command path with `docs/specifications/011-core/research/probes/issue-139/` and create the extracted source's dependency link with `ln -s "$PWD/node_modules" <extracted-source>/node_modules`.
