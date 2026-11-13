# Throwaway issue-207 probe

Run `python3 docs/specifications/013-vitest-runner/research/probes/issue-207/probe.py MODE`
from the Squeal checkout root. Modes: `control`, `warning`, `failure`, `exit`,
`crash`. The CLI path is pinned in the script; confirm its version before a
repeat. The committed JSON files are the original observations on 0.1.463.

This is research, not a regression test. Each case creates and deletes a
temporary Git repository. Its `node_modules` symlink is outside this checkout
and ignored in the fixture. No dependencies are committed or installed.
Each case checks load against CPU count, uses one fork, a 15 s gate budget
and a 25 s outer bound. The SIGKILL case kills only its own Vitest test worker.

A 1 ms teardown threshold triggers the real Vitest logger path cheaply.
It does not reproduce the original high-load cause. `control` uses 10,000 ms.
`exit` records Vitest intercepting `process.exit(7)`; `crash` uses SIGKILL.
Output JSON retains stdout and stderr, with the temporary root replaced by
`<fixture>`. The temporary kept-log paths no longer exist.
