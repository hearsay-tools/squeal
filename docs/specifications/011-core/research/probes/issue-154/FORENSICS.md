# Issue 154 forensic probes (row 011-303)

Throwaway. Both scripts only read. They start no daemon and run no test.
Findings: `../../issue-154-cause.md`.

```sh
P=docs/specifications/011-core/research/probes/issue-154
node $P/forensics.mjs ~/projects/cezar/.git/squeal \
  /home/agent/projects/cezar/.ai/cezar/worktrees/54350441-9b98-4083-8ee2-461e26f22d6d \
  1b7ced33f9e4f3cb 2026-11-06T04:20:00Z 2026-11-06T04:45:00Z
node $P/transcript.mjs \
  ~/projects/cezar/.ai/cezar/runs/54350441-9b98-4083-8ee2-461e26f22d6d.ndjson.br
```

`forensics.mjs` opens `store.sqlite` and `lint.sqlite` with
`readOnly: true`. It prints the worktree's checkpoints, runs, lint records,
lint bursts and how many times each lint check was linted. The third argument
is a neighbour worktree id: its store-busy notes show whether the shared store
was write-locked. The incident worktree was removed, so its `worktrees`,
`revisions` and notes rows are gone; runs, checkpoints and lint rows remain.
The store keeps pruning, so a later run may print fewer rows.

`transcript.mjs` prints the Squeal hook texts and Squeal CLI calls of one
Cezar run, with their times. Do not commit the outputs.
