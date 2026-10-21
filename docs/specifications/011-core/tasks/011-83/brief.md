# 011-83 brief: design, the host cap holds CPU, not test processes

The human, 2026-10-21, from the host-load review (`research/host-load.md` 1 and 5). Spec text now; code rows after the human accepts the design.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-83/design.md`, which the human can accept as an amendment to 011 C10's capacity text.

Read: the board's 011-83 row; `research/host-load.md` 1 and 5; 011 C10; `src/core/capacity/pool.ts` (the free worker beside the permits) and `src/core/scheduler/capacity.ts`; `../014-ps/research/process-measurement.md` (a process tree's CPU, children included).

Answer, each with a recommendation:

1. **Today's ceiling.** With N daemons and `hostSlots` S, how many test processes and how many cores can run, children of tests included. Read the pool marks and `/proc` read-only, at two moments, with the load.
2. **The free worker.** Why it exists (an edit never waits for a permit). Options: inside the pool when more than one daemon is up, a host-wide floor of free workers, or as today. What each does to an edited file's wait on a busy host.
3. **CPU as the measure.** Can a grant weigh a test's last-known process-tree CPU, or the host's niced CPU, instead of counting processes? Is it stable enough to schedule on?
4. **The default.** `hostSlots` against the CPU count.

## Rules for every host-load design

Include the spec text as drafts, the rejected options, and the decisions for the human at the top (as `tasks/011-62/design.md` does). Name each code row in order with its seam, owned files and the tests it lands red first. Four host-load designs run at once (011-82, 011-83, 011-84, 011-85): if a code row of yours touches another one's seam, say so.

Owns `tasks/011-83/` only, probes under `tasks/011-83/probes/`. Leave alone: spec, status, board, product code, other rows' folders.

The live host is read-only evidence. Never connect to a live daemon's socket, open a live store for writing, or signal a process. Probes run in a `git clone` under `/tmp` (never `git worktree add`: it shares the live store), with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`; a scratch daemon uses `baseline.onStart: lookup-only`, no slow lane, at most 4 test workers. No build. Remove your clones at the end. Record the one-minute load beside every timing.

Test runs: run single test files only. A full-suite verdict, if a probe needs one, is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so. A file that fails under load and passes alone is named in your notes.

Done when `design.md` is committed. Stop at the human's dated acceptance.
