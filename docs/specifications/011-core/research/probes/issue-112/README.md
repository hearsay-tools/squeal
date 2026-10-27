# Issue 112 probe

Throwaway research fixture. It creates a new Git repository in one unique temporary directory, links the checkout's installed dependencies, and runs only two synthetic Vitest files through a Squeal daemon owned by the probe. It never imports Cezarion or enumerates shared temporary roots. The cleanup test removes only children of a directory it minted and checks that a synthetic outsider survives. No `node_modules` is committed.

From the Squeal checkout root:

```sh
python3 docs/specifications/011-core/research/probes/issue-112/probe.py > docs/specifications/011-core/research/probes/issue-112/output.txt 2>&1
```

The script pins the installed Squeal 0.1.368 CLI path. Change that path explicitly to test another installation. Node 24.22.1 and the existing Vitest 5.0.3 dependencies were used. No install or build is needed. It skips before live work when one-minute load exceeds the CPU count. Commands, exit codes, status snapshots and the daemon log are in `output.txt`; fetched Cezarion source excerpts and exact fetch commands are in `sources.txt`.

Assertions cover rejected `pause` and `hold --file` forms, the existing whole-worktree hold, unrelated validation while the cleanup file is excluded, explicit `not-run` status for that file, and resumption after removal of the exclusion. Run counters prove whether each synthetic file executed. The hold's child has a 25-second bound, the hold a 30-second bound, and each status wait a maximum of 20 seconds. Teardown stops only the fixture daemon, confirms its exit, then removes only the fixture directory. Existing worktree holds are untouched.

This does not reproduce the reported destructive sweep. It does not prove that changing exclusions cancels an already running test, isolates global setup, prevents transitive execution, or contains arbitrary same-user code.
