# Spec 018 wave 6: gaps, proof and capture measurement

The human, 2026-11-10: "cezar proof: Yes, all four", "Row 018-23: Yes, now", "Capture: Yes, measure".

## 018-23 export evidence and reader gaps

Use /worker. Shape: repair.

Outcome: the gaps the last reviews left open are closed or narrowed with tests, so `squeal ci record --help`'s condition can name fewer cases.

Read: `reviews/wave-5-0.1.421-r3.md` (B1 fourth form and its two notes), `reviews/wave-5-0.1.422-r2.md` N1, `tasks/018-17/notes.md`, `tasks/018-20/notes.md`, `spec.md` D8, D9, D14.

Items, each with a failing test first:
1. Reads through an already open read-only descriptor or `FileHandle` (`read`, `readSync`, `readv`, `FileHandle.read`, read streams from an fd): hash the file again at each such read and treat a second content as the conflict rule does (the path loses its evidence).
2. A child process or worker started with a replaced environment (no `NODE_OPTIONS`): make the hook follow it (as the daemon's recorder does for spawned children, `src/runners/observe/spawn.cjs` is the reference, but do not change the daemon's recorder runtime), or record that the run started an unobserved Node child and drop every file of that shard's test from the export.
3. Descriptor time-stamp updates (`futimes`, `FileHandle.utimes`): count as writes.
4. The reader's `committedBlobs` `ls-tree` and `gitHead` fallback: take the stop signal and a timeout; the fallback does not run for an unborn `HEAD` unless needed.

If item 1 or 2 cannot be closed, say why in the final message; the condition then stays and names what remains.

Owns: `src/runners/vitest/ci-runtime/`, `src/core/ci/` except `publish.ts`, `src/core/shared/`, the git helper the reader uses if it is outside those, their tests; the help text of `squeal ci record` in `src/cli/main.ts` only to narrow the condition.

Leave alone: the daemon's recorder runtime (`src/runners/observe/`) and key inputs (`test/keys/key-format.test.ts` unchanged). No `pnpm run build`.

Done when: each item has a test that fails before and passes after (or a stated reason it cannot); the two-shard comparison still exports its 4 files; lint and typecheck clean; `squeal status` read once without `--wait`.

## 018-25 research: capture's real saving

Use /researcher. Answer topic `local-capture` recommendation 3 (`research/local-capture.md`): of the test runs agents started themselves in the last 7 days in squeal and in cezar, how many ran content (the test file's closure at that time) that the daemon had not yet run at that content within the run's span. Join the transcript runs of storable shape with the stores' runs of the same file and closure. Owns `research/capture-saving.md` and `research/probes/capture-saving/`. Copies of stores only, never the live stores; read transcripts read-only; no agent CLI against the real HOME. Done when committed with the counts per project, the CPU seconds they stand for, and a go/no-go recommendation for the capture reporter.
