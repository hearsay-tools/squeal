# 011-85 brief: design, a version raise or a sibling project's config does not re-key a whole suite

The human, 2026-10-21: a design row first, from 011-81's findings (`research/key-split.md`). Spec text now; code rows after the human accepts the design.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-85/design.md`, which the human can accept as an amendment to 011 C3 and C11.

Read: the board's 011-85 and 011-81 rows; `research/key-split.md` with `research/probes/key-split/`; `research/host-load.md` 3; 011 C3 (the key-format bullet) and C11; `src/core/keys/environment.ts`, `dependencies.ts`, `hidden-lockfile.ts`; `src/runners/vitest/project.ts`; `test/keys/key-format.test.ts`.

Answer, each with a recommendation:

1. **Npm input.** The hidden lockfile without the root's `name` and `version` and the workspace entries' `version`, tag `squeal-installed/2`: the C11 text, and pnpm's `link:` specifier case.
2. **Per-project config.** Each Vitest project hashes the root config, its own and their `configFileDependencies`: the C3 text and the adapter seam.
3. **Regressions.** The findings' five, each as a test with its fixture and its file.
4. **Release cost.** The change re-keys every check once. Can a lookup read the old fingerprint's rows, as 011-37 reads equivalent formats? Does the alarm name a case? Run that one file on a probe clone.
5. **The repository's own side.** Should this repository's `globalSetup` stop reaching `node:child_process`, beside or instead of the product change?

## Rules for every host-load design

Include the spec text as drafts, the rejected options, and the decisions for the human at the top (as `tasks/011-62/design.md` does). Name each code row in order with its seam, owned files and the tests it lands red first. Four host-load designs run at once (011-82, 011-83, 011-84, 011-85): if a code row of yours touches another one's seam, say so.

Owns `tasks/011-85/` only, probes under `tasks/011-85/probes/`. Leave alone: spec, status, board, product code, other rows' folders.

The live host is read-only evidence. Never connect to a live daemon's socket, open a live store for writing, or signal a process. Probes run in a `git clone` under `/tmp` (never `git worktree add`: it shares the live store), with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`; a scratch daemon uses `baseline.onStart: lookup-only`, no slow lane, at most 4 test workers. No build. Remove your clones at the end. Record the one-minute load beside every timing.

Test runs: run single test files only. A full-suite verdict, if a probe needs one, is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so. A file that fails under load and passes alone is named in your notes.

Done when `design.md` is committed. Stop at the human's dated acceptance.
