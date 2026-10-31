# Issue 130 throwaway probe

This is research, not a product test. It creates one temporary Git repository,
one tiny Vitest test and one foreground Squeal daemon. It links the caller's
`node_modules`; no dependencies or temporary stores are committed. It checks
one-minute load against CPU count before it starts. It never changes another
worktree's daemon. No host load is generated.

From the repository root, the recorded commands were:

```sh
python3 docs/specifications/011-core/research/probes/issue-130/probe.py \
  /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.383/dist/cli/squeal.mjs \
  "$PWD/node_modules" 60000 \
  > docs/specifications/011-core/research/probes/issue-130/output-0.1.383.jsonl
python3 docs/specifications/011-core/research/probes/issue-130/probe.py \
  "$PWD/plugins/claude-code/dist/cli/squeal.mjs" "$PWD/node_modules" 3000 \
  > docs/specifications/011-core/research/probes/issue-130/output-0.1.384.jsonl
```

The first run's discovery loop waited up to 60 reads for a current result.
The lookup-only baseline meant the named wait then requested the fixture's
first run. The saved script now waits only for listing and asserts that this
baseline wait exits 0 before it changes liveness. Neither change affects the
stall cases. Baseline waits allow 30 seconds even for a shorter probe deadline.

Each output line is JSON. CLI records retain the full stdout, stderr, exit and
wall time. Socket records distinguish connection success from a reply:

1. Obtain a current passing result and a ping reply.
2. Send SIGSTOP only to the owned daemon. Wait two heartbeat intervals plus one
   second. Check ping and sync with a 2-second socket deadline, then run the
   named wait. A successful connection does not mean a reply arrived.
3. Send SIGCONT and confirm a passing named wait.
4. Set the isolated store's heartbeat to 30 seconds ago. An SQLite trigger
   keeps only that timestamp fixed while the real daemon runs and replies.
   Check ping, sync and sync-status, then the named wait and a 3-second text
   wait. This is artificial fault injection, not a claim about the incident's
   cause. The trigger changes no result, key or revision.
5. Drop the trigger, wait one heartbeat interval plus one second, and confirm
   recovery. Finally resume/terminate the owned process group and remove the
   temporary directory, even on a Python exception.

The installed runtime and the repository's already-committed bundle are used
as-is. No build, full suite, hook registration or external worktree mutation
is part of the probe.
