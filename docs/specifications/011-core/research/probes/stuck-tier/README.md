# Probes for `research/stuck-tier.md` (row 011-71)

Throwaway. Nothing here is product code or a test of the suite.

- `evidence.cjs`: reads the shared store through a `readOnly` `node:sqlite` connection and prints the rows the findings cite. Run as `node evidence.cjs <store.sqlite> b3025782c392379a test/daemon/composite-runner.test.ts`. Its output at 16:08Z on 2026-10-21 is `results/store.json`.
- `results/proc.txt`: `/proc/709144` at 16:08Z (state, children, threads by wchan, fds by target). Read with `ps`, `ls` and `cat` only; no signal was sent.
- `stuck-running.test.ts`: the reproduction. Copy it to `test/scheduler/` of a scratch clone at `squeal--v0.1.238` (commit 9e82037b1) and run `npx vitest run test/scheduler/<name>` with a scratch `HOME` and `XDG_*`. It passes on 0.1.238: the defect holds. It prints one JSON line with the state it asserts.
- `fix.patch`: the candidate fix, against 9e82037b1. With it the probe fails on its first assertion (the defect is gone), and the printed line shows the file run again and the checkpoint complete.

The scratch clone was `/tmp/stuck-tier-ccf7e51d/clone`, with `node_modules` copied from a worktree whose `package-lock.json` equals the tag's.
