# Issue 36 probe (throwaway)

Throwaway evidence for `../../issue-36.md`; delete freely. Not product code, not a test.

`probe.sh <squeal.mjs> <touches> <vitest node_modules> [baseline|edit]` writes a three-file repo
(`tests/a.test.ts`, `tests/b.test.ts`, `tests/ok.test.ts`) under a fresh `/tmp/issue36.XXXX`, with
`HOME` and `XDG_*` inside it, so no daemon or store reaches the real HOME. `a.test.ts` imports the
git-ignored `dist/lib.js` and, while a counter file outside the worktree is above zero, rewrites it
with the same bytes during its run. With `edit`, the baseline runs clean first, then an edit to
`a.test.ts` starts the touching runs, so only that file goes `unknown`. The script then runs
`squeal retry` (both reasons), a named wait, sets the counter to 0 and runs `squeal run --all --wait`.

Runs kept:

- `output-0.1.199-touch1.txt`: one touch; the 007-30 barrier re-ran the tier, nothing ended unknown.
- `output-0.1.199-touch5.txt`: touches from the baseline; both files unknown, `run --all` ran both.
- `output-0.1.199-edit.txt`, `output-0.1.213-edit.txt`: the narrow case, 2 current and 1 unknown.

CLIs: installed `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`, and the
committed `plugins/claude-code/dist/cli/squeal.mjs` at `8ec92f9b` (0.1.213, not rebuilt). Vitest
4.1.10 from `/home/agent/projects/cezar/node_modules`, symlinked read-only.
