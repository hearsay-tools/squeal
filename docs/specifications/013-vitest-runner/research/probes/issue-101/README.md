# issue-101 probes (throwaway)

Throwaway triage probes for hearsay-tools/squeal#101, 2026-10-26. Not product
code, not tests; delete freely. Findings: `../../issue-101.md`.

- `probe.ts`: one fixture test (a copy of `test/fixtures/vitest/basic` under
  the git-ignored `test/fixtures/vitest/.tmp/`) spawns a detached `sh` that
  forks `holder.cjs` and exits; the probe runs it through the real
  `VitestAdapter`, aborts the run with a scheduler cause, and reports whether
  the holder lives. Modes: `control` (no abort), `await` (the test waits on a
  timer loop at the abort), `block` (the test blocks its event loop),
  `slow-teardown` (as `await`, but `afterEach` sends SIGTERM to the group and
  waits 2 s before SIGKILL, as a supervisor stop does).
- `holder.cjs`: ignores SIGTERM, writes `--ready <path>` once its handler is
  in place, exits after `--lifetime` ms (60 s here). `out-*.txt` are the
  runs of 2026-10-26; `out-slow-teardown-supersession-racy.txt` predates the
  ready mark and is void (see the findings file); `out-control.txt` also
  predates it (its holder was already gone at the first read), and
  `out-control-supersession.txt` is the control with the ready mark.
- Bounds: the probe exits within 120 s; it SIGKILLs only holder pids it
  recorded whose command line carries its random token.

Run from the repository root:
`npx tsx docs/specifications/013-vitest-runner/research/probes/issue-101/probe.ts <mode> [cause]`
