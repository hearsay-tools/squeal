# Probe: daemon lifetime under harnesses (001-66)

Throwaway. Not product code; nothing here is imported by Squeal. Delete at will.

`probe.mjs` mimics the chain a Cezar worker has: a controller (Cezar spawns
`claude` without `detached`) runs a hook, the hook spawns a stand-in daemon
exactly as `src/core/daemon/ensure.ts` does (`detached: true`,
`stdio: 'ignore'`, `unref()`) and exits. It reports pid, ppid, pgid, sid and
cgroup of each, kills the controller's whole process group (stronger than
Cezar's `child.kill(SIGTERM)` on the `claude` pid), runs Cezarion's own
working-directory scan (`processesWithCwdUnder`, installed
`@wjarka/cezarion` 0.15.1-dev.1436) over the worktree and scratch paths, and
then `git worktree remove` on a real linked worktree. It runs twice: the
stand-in daemon's cwd set to the worktree root (the plugin before 001-61) and
to `<common-dir>/squeal/` (after 001-61). It kills only the processes it
started.

    node probe.mjs > output.txt

Result (2026-10-07, `output.txt`): in both variants the stand-in daemon has
pid = pgid = sid, is reparented to `systemd --user` at once, shares the
controller's cgroup, and survives a SIGKILL of the controller's group.
Cezarion's scan reports it only when its cwd is inside the worktree.
`git worktree remove` without `--force` succeeds in both. The stand-in does
not adopt Squeal's temp directory, so its `TMPDIR` is the spawner's; the
real daemon's `TMPDIR` is covered by `test/daemon/scratch*.test.ts`.
