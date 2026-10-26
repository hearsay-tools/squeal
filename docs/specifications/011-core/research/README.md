# Research for spec 011

Links only. The findings behind this spec were written for 001 and stay in `../../001-core-loop/research/`; a new topic gets a brief here and its findings file beside it.

- [result-fingerprinting-prior-art](../../001-core-loop/research/result-fingerprinting-prior-art.md)
- [watcher-daemon-and-shared-store](../../001-core-loop/research/watcher-daemon-and-shared-store.md)
- [pull-advances-push](../../001-core-loop/research/pull-advances-push.md)
- [per-package-keys](../../001-core-loop/research/per-package-keys.md)
- [harness-process-liveness](../../001-core-loop/research/harness-process-liveness.md)
- [process-group-tests-under-squeal](../../001-core-loop/research/process-group-tests-under-squeal.md)
- [observed-runtime-inputs](../../001-core-loop/research/observed-runtime-inputs.md)
- [shared-runs](../../001-core-loop/research/shared-runs.md)
- [wait-from-store](../../001-core-loop/research/wait-from-store.md)
- [nested-worktree-watch](../../001-core-loop/research/nested-worktree-watch.md)
- [injected-environment](../../001-core-loop/research/injected-environment.md)
- [host-capacity](../../001-core-loop/research/host-capacity.md)
- [environment-failures](../../001-core-loop/research/environment-failures.md)
- [daemon-sigkill](../../001-core-loop/research/daemon-sigkill.md)
- [daemon-under-harnesses](../../001-core-loop/research/daemon-under-harnesses.md)
- [fresh-worktree-reuse](../../001-core-loop/research/fresh-worktree-reuse.md)
- [slow-claims](../../001-core-loop/research/slow-claims.md)

## Briefs for new topics

- [issue-20-brief](issue-20-brief.md): setup failures under Squeal's own tmp root (gh-20; the human, 2026-10-17: reproduce first). Findings go to `issue-20-reproduction.md`.
- [issue-33-dist-brief](issue-33-dist-brief.md): whether a `dist` rewrite drops runs that loaded the same bytes (gh-33; the human, 2026-10-20: one researcher). Findings go to `issue-33-dist.md`.
- [key-format-guard-brief](key-format-guard-brief.md): when a check key should change across releases, and a mechanism that decides it (the human, 2026-10-20). Findings go to `key-format-guard.md`.
- [daemon-scope-brief](daemon-scope-brief.md) (011-52): one daemon per repository instead of one per worktree, from the 2026-10-21 memory figures and usage since 2026-10-13 (the human, 2026-10-21). Findings go to `daemon-scope.md`.
- [daemon-memory-brief](daemon-memory-brief.md) (011-53): what a quiet daemon gives back after a forced GC and after closing its Vitest instance, and the next edit's cost (the human, 2026-10-21, after 011-52). Findings go to `daemon-memory.md`.
- [backlog-wall-budget](backlog-wall-budget.md) (001-366; brief `../tasks/wave-3.md` R1)
- [cli-build-inputs-brief](cli-build-inputs-brief.md) (011-127): what keys a test that builds the CLI at run time, and the cost of each fix (coordinator 04a258b0, 2026-10-23, wave 21 R1). Findings go to `cli-build-inputs.md`.
- [issue-75-77-brief](issue-75-77-brief.md) (011-133): what starts the old-version daemons in a handover that does not converge (gh-75, gh-77; the human, 2026-10-23, digest group A). Findings go to `issue-75-77.md`.

- [main-pull-reuse-brief](main-pull-reuse-brief.md): explain about 50% result inheritance after pulling the Cezar main checkout (human, 2026-10-26). Findings go to `main-pull-reuse.md`.

- [main-pull-checkpoint-brief](main-pull-checkpoint-brief.md): follow-up on unfinished Cezar main checkpoints and terminal-only run lifecycle (human, 2026-10-26). Findings go to `main-pull-checkpoint.md`.
