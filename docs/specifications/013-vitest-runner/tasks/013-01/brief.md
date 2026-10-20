# 013-01 brief: design, a touch withholds only what the instance could have read

Approved by the human on 2026-10-20 (triage gh-33, "design row first"). Spec text first; the code row is numbered after the human accepts the design.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/013-01/design.md`, which the human can accept as an amendment to V5's "Touched files" (task 001-159).

Read: the board's 013-01 row; 013 V5 and V7; 011 C2 and C4; `../../011-core/research/issue-33-dist.md` and `issue-33.md` with their probes; the reviews behind 001-159 and 001-176 (`../../001-core-loop/reviews/wave-13*.md`). Seams, read only: `src/runners/vitest/moved.ts` (`withoutTouched`, `mayHaveRun`), `src/runners/vitest/adapter.ts` around its touch handling, `src/runners/vitest/sources.ts`, `src/core/hash/stat-cache.ts`.

Answer, each with an evidence tag and one recommendation:

1. For each cache V5 names (a virtual module's declared input with its own transform, processed CSS and what it `@import`s, the optimizer bundle, off since 001-176), and any other you find: does its read reach the module graph or a stamp the adapter sees? Run one cheap probe per cache where the source does not settle it.
2. The narrowed rule: which touches withhold (a path an environment cached or stamped, a declared or virtual input of one, a CSS dependency), which test files (the `mayHaveRun` walk), and when the instance must still be replaced.
3. Whether a same-bytes write in place (`tsc`) can hand a loaded module truncated bytes, and whether the stamp catches it.
4. Why `.d.ts` and `.js.map` paths no closure names reach the adapter as touches, and whether they should.
5. Whether the node:test adapter has a touch rule of its own.
6. The code row: seams, owners, regressions (a touch of a file in no closure of the run withholds nothing; a touch of a loaded file still withholds; a second touch during the re-run).

Include V5 spec text as a draft and the rejected options. Out of scope: keys, stamps, re-enabling the optimizer.

Owns `tasks/013-01/` only, probes under `tasks/013-01/probes/`. Leave alone: spec, status, board, product code. Probes run in a throwaway repo under `/tmp` with `HOME` and `XDG_*` there, only while the one-minute load is below the CPU count; no full suite, no build. Done when design.md is committed. Stop: the human's dated acceptance.
