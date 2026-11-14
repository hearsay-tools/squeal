# Wave 20 (the human, 2026-11-14: "#212: Research first", "Row 020-55: Build it")

Two rows on disjoint seams, in parallel, from main (0.1.477). Host load swings between 40 and 190 on 24 CPUs: targeted tests only, no full suite, no `pnpm run build` in a worker tree; load timeouts are load, not findings. Notes in `tasks/wave-20-<row>/notes.md`.

## 020-56: research: a bounded gate for a change to a shared Vitest setup file (#212)

Use /researcher. Shape: research. Read issue #212, `research/issue-212.md` (the triage), spec D3, D5, D6, D14, D17 and D18, and closed #175 with row 020-17 (an earlier case of the same shape).
- Questions: (1) On a quiet host (one-minute load below the CPU count; wait for it, never make load), how long does the gate take on a fixture shaped like #212 (a `setupFiles` entry every test file loads, a few hundred test files, a change to the setup file and to other files), and what do the existing early lines say (D17.1 estimate, the rerun command, the early stop at twice the budget)? Why did the reporter not act on them (no stored durations, wording, order)? (2) Which bounded rules could give a complete verdict for such a change, with evidence: for example, the setup file's own functions count as covered once any completed file ran them, and every other changed function still needs its own loaders. For each rule: what a pass would then mean, what it could miss (a setup change that breaks only some test files), which D5 or D6 text and policy version it changes, and its cost on #212's shape. (3) What other tools do for a shared setup or fixture change (Jest `--changedSince`, Nx/Turborepo affected, Bazel, pytest-testmon), from their docs.
- Probes: throwaway repositories under `/tmp` or the notes folder, the packaged CLI of the current release; never the real HOME; record load per run.
Output: `research/issue-212-setup.md` with answers tagged by evidence kind, the probes kept under `research/probes/issue-212/`, and a recommendation the human can decide on. No product edit.

## 020-55: the gate keeps the result of a file it reran under load

Use /worker. Shape: slice. Read row 020-54's notes, section "What follow-up B needs" (`tasks/wave-19-020-54/notes.md`), spec D3.4 and D17.3 as amended by 020-54.
- Today a file the gate reran under load keeps neither run (`keep-expected.ts` `Expectations.take` serves a file's first run only). Keep the rerun's result at the file's key, as the daemon's own rerun replaces its row: keep the retried files' expectations open past the first tell, or add them again from the same lookup before the rerun (a new `keys.beginRun()` and a fresh inputs snapshot). The stability window covers the lookup to the rerun's end, so an input edited during either run bars the keep. The first failure is never kept.
- First edit, as a lead: in `lanes.ts` `runOne`, tell the rerun to `options.ran` (drop the `rerun === undefined` guard on `tellRan`), then make `keep-expected.ts` serve it.
Owns: `src/core/code/gate/{keep,keep-expected,keep-here,keep-write,lanes,retry,collect}.ts`, their tests, including `test/cli/code-gate-retry.test.ts`. A new `RunReport` field, if any, needs its rule in `src/core/daemon/report-merge.ts` (`MERGE_RULES`); say so in notes before adding one.
Done when (tests): the second gate on the same bytes reads a retried file `from: store` with the rerun's outcome; an input edited during the rerun is not kept; the first failure is never kept; D17.3's text in notes.
