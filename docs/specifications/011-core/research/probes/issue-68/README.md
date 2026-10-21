# Issue 68 probe (throwaway)

Throwaway. Not product code, not a test. Delete when issue 68 is settled.

`run.sh <claude-code-plugin-dist> [<scratch-dir>]` builds a one-worktree git
repository from `fixture/` under the scratch directory (default
`/tmp/issue68-probe`), with its own `HOME` and `XDG_RUNTIME_DIR`, so the store,
sockets and user config never reach the real ones. It installs Vitest 5 into the
scratch tree; `node_modules` and the run output stay out of git.

Fixture: `helper.ts` (returns 1), imported by `a.test.ts` and `b.test.ts`;
`other.test.ts` imports nothing. Branch `side` sets the helper to `return 2`,
`main` to `return 3`, so `git merge side` stops on a content conflict in
`helper.ts`.

Steps, each printed with its output and a timestamp:

1. SessionStart hook, `squeal start`, `squeal run --all --wait`, PostToolBatch hook.
2. `git merge side` (conflict), `git ls-files -u`, the conflicted file,
   `squeal status --wait 60000`, `status --full`, PostToolBatch hook, `why a.test.ts`.
3. a. Write the resolved file only; `git ls-files -u`; `status --wait`; hook.
   b. `git add helper.ts`; `git ls-files -u`; `status --wait`.
   c. `git commit --no-edit`; `status --wait`; `status --full`; hook.
4. `squeal stop`.

Run from the Squeal worktree root, after checking load against the CPU count:

    docs/specifications/011-core/research/probes/issue-68/run.sh plugins/claude-code/dist /tmp/issue68-probe > /tmp/issue68-output.txt 2>&1
    rm -rf /tmp/issue68-probe /tmp/issue68-output.txt
