# Probes for `revert-restore-pass-2.md` (task 001-343)

Throwaway. Nothing here is built, linted or run by the repository. Every file ran on scratch copies
of this branch outside any worktree (`git archive HEAD`, `node_modules` linked), never on a worktree
or a daemon of the project.

- `instrument.py`: adds a JSON-lines log (`$SQ_PROBE_LOG`) to a copy's `adapter.ts` (`run-start`,
  `run-executed`, `run-end`, each `invalidate` with what Vite holds of `src/mod.ts`) and to
  `SourceStamps.#stamp` (each read of `src/mod.ts` and its hash).
- `make-probe.py`: writes `test/probe/rr.test.ts`, a copy of `test/integration/revert-restore.test.ts`
  that logs every attempt (armed and restored times, load) and dumps the store's revisions, runs and
  results before line 195. `SQ_PROBE_GATE=1` makes route A deterministic: a setup file holds the
  run of the truncation's revision until the bytes and their own revision landed.
  `SQ_PROBE_TRUNC_MS` writes the test file empty first, then its bytes after that many ms.
- `analyze.py`: per repetition and attempt, the armed run, whether the adapter kept it, the
  mid-window invalidates of `src/mod.ts` (`cached`: 001-264's case, `in flight`: 001-343's), the
  revisions naming the test file and the module, and which run's result line 195 read.
- `rounds.sh`: rounds of N copies per variant, optionally pinned with `taskset` beside busy loops
  pinned to the same CPUs, so only the probe's processes starve.
- `end-check-cost.test.ts.txt` with `timing.patch`: the run's end check timed at 200 to 5,000
  modules, with the 9dcec7f8 loop timed on its own.
- `results/`: the analyzer's summaries of every set in the findings.

Variants: `unfixed` has `sources.ts` from before 9dcec7f8 (5fadbea8); `fixed` has it at 97350b49.
