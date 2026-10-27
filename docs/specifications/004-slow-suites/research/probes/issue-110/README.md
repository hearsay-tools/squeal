# Issue 110 throwaway probe

This is a throwaway research fixture, not a product test or a proposed fix.
Run from the Squeal checkout root on Node 24:

```sh
node docs/specifications/004-slow-suites/research/probes/issue-110/probe.mjs > docs/specifications/004-slow-suites/research/probes/issue-110/result.jsonl 2>&1
```

The script checks one-minute host load against CPU count before starting a
daemon. Above that count it prints the values and skips the live probe.
It uses the checkout's committed Claude Code CLI bundle, prints its version
and the checkout commit, and creates a temporary Git repository with five
independent node:test files. It installs no dependencies and keeps no
`node_modules` in Git.

Three fast files wait on release files outside the fixture repository. Two
slow files finish immediately. These gates control order without CPU work
or source edits. The baseline queues missing files, each fast tier holds one
file, and the continuous slow lane holds one file. The private runtime
directory isolates sockets and slow permits from other worktrees. The
fixture has its own store and no browser environment lease.

While the first fast file runs, `status --json --wait 4000 slow-z.test.mjs`
opens a named wait. The script releases that fast file and captures the
second fast file running while both slow files remain pending. It checks
that the wait times out with exit 3. A second named wait opens before the
remaining gates are released. It checks exit 0 and the order: all fast files,
then the named `slow-z`, then the unnamed `slow-a`.

`result.jsonl` is the retained 2026-10-27 run: exact child commands, policy,
host values, selected status snapshots, raw wait outputs, file events and
cleanup results. Exit 0 means every assertion passed. The script stops its
own daemon and deletes its temporary repository/runtime in `finally`.
The missing-input notes in daemon stderr refer to these deliberate external
release files; no product inputs change during the experiment.

This measures lane order on a real CLI, daemon and node:test adapter. It does
not recreate cezarion, its browser runner, 611-file queue, shared contract
edit, or wall-clock wait. No Squeal repository suite runs.
