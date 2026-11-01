# Wave 17: Codex cells reach Squeal again (row 006-100)

Coordinator 6e3bce1c, 2026-11-01. The human approved row 006-100 on 2026-11-01 (decision card cdfc5f78: "Codex evals: Yes, fix and re-run"; then the long run on both models). Host policy as in `011-core/tasks/wave-60.md`: no local full suite, no `squeal run --all`, no `pnpm run build`, never make CPU load on purpose. **Never run `evals/bin/*.mjs`, not even with `--help`: that starts a real eval run.** No real `codex` or `claude` session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `evals/results/`, bundles, version.

## 006-100

Use /worker. Shape: repair.

Outcome: on a pin at or after `e34c9bc1f` (0.1.368), a Codex cell finds the shipped Codex CLI, trusts its hooks and reaches a daemon, as a fresh Codex install does; pins before it work as today.

Evidence: atomic run `20261031T221020Z-ec45fb` on 0.1.387, kept in `evals/results/invalid/` with its README. Its log showed `ERR_MODULE_NOT_FOUND` for `<pin>/plugins/codex/dist/cli/squeal.mjs` at the trust step, warm-up and end status. In 0 of 100 graded Codex cells did a daemon show in the timeline.

Read: spec 002 D7 to D9 (one fixed plugin, a `seed/`, separately versioned runtimes); `plugins/codex/bin/squeal-launcher` header (how a session finds its runtime: data directory, `CODEX_HOME`, else the seed); `evals/README.md` on cells and pins.

Seam and lead: `evals/bin/run-cell.mjs:199` sets `CLI` to the old path. A lead, not a ruling: since 0.1.368 the CLI ships in `plugins/codex/seed/dist/cli/squeal.mjs`, which a fresh install runs. Check also `squealBin` (`evals/lib/scratch.mjs:70-75`) and the Codex install at `run-cell.mjs:222-228`. Take the path the shipped launcher takes in a fresh cell. Add a guard: a run whose pinned CLI does not exist stops with a named error before any session.

Owns: `evals/bin/run-cell.mjs`, `evals/lib/{scratch,prepare,variant}.mjs` as needed, `test/evals/**`. Leave alone: `src/`, `plugins/`, `evals/results/`.

Done when: a test resolves the CLI for a pin tree with the old layout and one with the new layout; a missing CLI fails before any session with a named error; `squeal status --wait 60000` on the changed paths is current; lint and typecheck pass. Do not run a cell yourself; the coordinator runs the smoke in the eval sandbox.

## R1: review of 006-100

Use /reviewer. Shape: review. Candidate `cand/006-100` at `db208094272b94d693effcfb85c21435fa561786` (main `9eaec5eb0` plus three commits: `db5eb6957`, `3b1668d52`, `db2080942`); CI run 41284781091. Range `9eaec5eb0..db2080942`.

Read: the brief above, `tasks/006-100-notes.md`, spec 002 D7 to D9, spec 006 D3 (cells) and D10 (atomic tier).

Check: (1) a Codex cell on a pin from 0.1.368 on runs that pin's own runtime, never the frozen seed, for every Squeal command the cell makes and for the session's hooks and bare `squeal`; (2) pins before `e34c9bc1f` are unchanged; (3) `MissingPinCli` stops a run in `run-baseline.mjs` before any cell (it runs after judge calibration; say whether that order costs anything); (4) the cell's background runtime download (notes) cannot change which runtime the session measures; (5) the `noskill` variant still removes the skill a Codex session sees, or name what it now measures; (6) no cell path can reach the real HOME. The coordinator's smoke: cell `a7-stale.p0.codex-gpt-6.1-sol.e-medium.r1`, run `20261101T072509Z-c7a6f0`, graded `claim-true` and `current-before-claim` true, end status showed a daemon. **Never run `evals/bin/*.mjs`, not even `--help`: it starts a real run.** No full suite. Write `reviews/006-100.md` with PASS or FAIL and commit it alone.
