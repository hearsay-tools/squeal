# Issue 168 throwaway probe

This is research, not a product test. It creates a tiny private Git repository
under Python's temporary directory, with its own Squeal store and runtime/config
directories. `node_modules` stays outside Git. It links the checkout's existing
ESLint 10.13.0; it installs nothing. Node is 24.22.1. No external suite runs.

Run from this checkout:

```sh
python3 docs/specifications/011-core/research/probes/issue-168/probe.py
ISSUE168_SLOW_LINT=1 python3 docs/specifications/011-core/research/probes/issue-168/probe.py
python3 docs/specifications/011-core/research/probes/issue-168/inspect-store.py <PRIVATE_ROOT printed by probe>
```

The script skips when one-minute load exceeds `nproc`. It uses the installed
0.1.422 CLI and extracts Claude Code hooks from `squeal--v0.1.422` with `git show`.
Both must exist locally. The hooks are called through JSON stdin, without a model.
It stops its daemon in `finally`; fixtures remain available for read-only inspection.

Before registration it creates A and B. B changes only `src/a.js`, from complexity
1 to 8, then the worker branch starts at A. One node:test loads the source but
never calls its function. It primes A's results, registers at revision 0, checks
Stop without changes, starts the next turn, then runs only
`git merge --ff-only origin/main`. The CLI and hooks observe B. Every Git status
check is clean. Logs contain all subprocess commands, hook inputs, outputs and
exit codes. Python's file writes and sleeps are explicit in `probe.py`.

- `fast-lint.log`: current script, normal ESLint rule. Load 2.91/24. Stop holds
  for one pending lint check; a tool boundary reports one CRAP change.
- `pending-lint.log`: current script with the slow flag. Load 4.00/24. The local
  rule sleeps five seconds on B with `Atomics.wait` (no busy loop). Same hold.
- `store-evidence.log`: `inspect-store.py` on that second fixture. The pulled
  record names `src/a.js` at revision 1; all three measures have null edit marks.
- `settled-control.log`: earlier fast variant, load 3.65/24. It omitted the second
  UserPromptSubmit after the control Stop, leaving the consumer paused. Lint was
  already current at the later Stop, which did not block. It is a timing/control
  observation, not a comparison that isolates only lint speed.

Two setup attempts preceded these observations: the first used the nonexistent
Claude `post-tool-use` filename, corrected to `post-tool-batch`; the second
incorrectly declared dependencies without an installed lockfile and never got a
listed test or code count. Neither is reproduction evidence. The final manifest
has no dependencies (node:test needs none), and ESLint resolves from its explicit
local link. This does not test an installed-lockfile cache or cross-worktree reuse.
