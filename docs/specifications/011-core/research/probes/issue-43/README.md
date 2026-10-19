# Probe: issue 43 (throwaway)

Throwaway research fixture for `../../issue-43.md`. Not product code, not a test.

`setup.sh [dir]` builds a one-file Vitest 5 repository at `/tmp/issue43-fixture`
(outside this worktree) with `squeal.config.json` `{ "runner": { "timeoutMs": 5000 } }`.
The test sleeps for the number of milliseconds in `/tmp/issue43-delay-ms`, a file
outside the fixture, so the same key can be made slow (8000, over the cap) and then
fast (100). The command sequence and output are in `../../issue-43.md`. Stop the
fixture's daemon with `squeal stop` in the fixture when done; `node_modules` and the
fixture never enter git.
