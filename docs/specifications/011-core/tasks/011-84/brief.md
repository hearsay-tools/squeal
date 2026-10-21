# 011-84 brief: design, departed and unused daemons end sooner

The human, 2026-10-21, from the host-load review. Spec text now; code rows after the human accepts the design.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-84/design.md`, which the human can accept as an amendment to 011 C9.

Read: the board's 011-84 row; 011 C9 and C10 (the slow lane); `research/daemon-scope.md` 3; `../014-ps/research/should-not-be-up.md` 2; `src/core/daemon/lifecycle.ts`, `daemon.ts` (the drain), `slow-instance.ts`, `policy.ts` (`daemon.unusedExitMinutes`); task 004-60 (the slow lane waits for its daemon's fast backlog).

Answer, each with a recommendation:

1. **The drain.** When a daemon's last session leaves, should it still run its whole fast backlog? Options: stop at the running tier; finish only the files the departed session edited; as today. What results a later session loses with each.
2. **Unused.** Should a queued backlog, or a wait for a slot, count as use under `daemon.unusedExitMinutes`? Read the live daemons read-only (`squeal ps --json` is allowed) and give the memory and permits each option frees.
3. **Coming back.** An exit-when-quiet rule must queue the edit that brings a daemon back under `lookup-only` (Later, from 011-53). The rule and its test.

## Rules for every host-load design

Include the spec text as drafts, the rejected options, and the decisions for the human at the top (as `tasks/011-62/design.md` does). Name each code row in order with its seam, owned files and the tests it lands red first. Four host-load designs run at once (011-82, 011-83, 011-84, 011-85): if a code row of yours touches another one's seam, say so.

Owns `tasks/011-84/` only, probes under `tasks/011-84/probes/`. Leave alone: spec, status, board, product code, other rows' folders.

The live host is read-only evidence. Never connect to a live daemon's socket, open a live store for writing, or signal a process. Probes run in a `git clone` under `/tmp` (never `git worktree add`: it shares the live store), with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`; a scratch daemon uses `baseline.onStart: lookup-only`, no slow lane, at most 4 test workers. No build. Remove your clones at the end. Record the one-minute load beside every timing.

Test runs: run single test files only. A full-suite verdict, if a probe needs one, is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so. A file that fails under load and passes alone is named in your notes.

Done when `design.md` is committed. Stop at the human's dated acceptance.
