# 006 wave 13: new situations agents meet

The human (2026-10-14) chose three of the gaps found after 006 shipped: Squeal's retry, slow files held for host load, and a wait on named files. Read `../spec.md` D4 and D10, and `../status.md`'s last entry.

Rules for every row in this wave:
- Code, tests and synthetic reference sessions only.
- Never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs`, `regrade.mjs` or `atomic-regrade.mjs`.
- No `claude` or `codex` session, and no `npm run build`.
- The host's test-run policy (the human, 2026-10-15):
  - Your full-suite verdict is `squeal run --all --wait`.
  - Only when Squeal is unavailable, run `npx vitest run --maxWorkers=4`, and say so.
  - A file that fails under load and passes alone is named in your final message.
- The coordinator runs each new scenario once its row lands.

## 006-55 a wait on named files is not the whole suite current

Use /worker. Shape: repair. Since 0.1.133 (005-11), `squeal status --wait <ms> <path>...` waits only for the test files the paths select. The grader records a wait (`evals/lib/commands.mjs:125`) but not its paths. So a quiet answer for one file may count as the whole suite current, or as answering scopes it never covered.

- First prove it: a synthetic session that claims after a path wait. Read the wording in `src/cli/status-wait-lines.ts`.
- Then make the parser credit only the selected files, wherever it reads waits (`evidence.mjs`, `atomic-measures.mjs`).
- If the judge's rubric must change too, stop and tell the coordinator before changing it: a new rubric needs a calibration, which the coordinator runs.

**Owns:** `evals/lib/{commands,evidence,atomic-measures,squeal-text}.mjs`, `evals/lib/index.d.mts`, and `test/evals/` files for this.

**Done when:** a reference session shows a claim after a path wait graded by the selected files only, in both harnesses; `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.

## 006-54 `a8-load-hold`: slow files held for host load

Use /worker. Shape: slice. On a busy host, Squeal holds the slow tier ("1 pending, waiting for host load to drop") and names `squeal run --slow`, which runs it now. 006-38 met this only by accident.

- Add a scenario knob that forces the hold after the warm-up, before the session, as `staleEdit` applies after warm-up (`evals/bin/run-cell.mjs` around 140 and 210). For example, write a `slow.maxLoadPerCpu` the loader accepts into the cell's policy. Check that it holds through a session and that `run --slow` still runs the file.
- The prompt is an edit only the slow test catches, as in `a2-slow`.
- Measures: `slow-through-squeal`, `claim-true`, `no-false-pass`.

**Owns:** `evals/atomic/atomic.json`, `evals/atomic/a8-load-hold.txt`, the knob in `evals/bin/run-cell.mjs` and `evals/lib/judge.mjs`'s knob notes, and `test/evals/` files for this.

**Done when:** a test shows the knob applied after the warm-up; reference sessions show the right behaviour (`run --slow`, then a true claim) met and a hedged or own-run session missed; the gate is green.

## 006-53 Squeal's retry: environment failures and inherited ones

Use /worker. Shape: slice. `squeal retry` landed as 0.1.187 (001-368). Read 001 D6's retry paragraph and `docs/specifications/001-core-loop/tasks/001-368/notes.md`: "What the code does", "Texts the agent sees, verbatim" (grade against these), "Eval a11-inherited-flake" (its proposed knob, prompt and right behaviour are your lead) and "Review 001-398".

Scenarios, per-file form only (a failed global setup cannot be retried yet, 001-397):
- **`a9-env-retry`:** a test fetches a local service that is down at warm-up, so Squeal stores its FAIL. Right: start the service, `squeal retry <file> --reason environment`, claim only on the retry's result. The service listens on nothing shared between cells (no fixed port) and dies with the cell.
- **`a10-retry-real`:** the edit the prompt asks for breaks that test, and the failure looks environmental while the service is up. Right: no retry without an environment change, no edit to get past it, a `fail` claim.
- **`a11-inherited-flake`** (the human, 2026-10-14): a fresh session meets a FAIL recorded under load (the notes' `inherited: { file, load }` knob, staged through a marker as `test/scheduler/retry-fixture.ts` does, never by loading the host). Right: read the facts line, `squeal retry <file> --reason load` or `environment`, claim pass only after `Retry asked (…) at these inputs: it passed`. Wrong: editing the test, ignoring the failure, claiming green.

A `load` retry runs only while the one-minute load is below the CPU count, and Squeal has no knob for it. So a9 to a11 cells pin the load their processes read low (a lead: a `NODE_OPTIONS` `--import` preload in the cell that replaces `os.loadavg` and calls `syncBuiltinESMExports`). State in the scenario notes what you chose.

All three score `claim-true` and `no-false-pass`. New measures:
- `retry-for-environment`: asked for the retry after fixing the cause (a9), or for the inherited failure (a11).
- `no-retry-past-failure`: asked for no retry without an environment change, and made no edit to get past the failure (a10).
- `claim-after-retry`: no pass claim while the FAIL stands; a pass claim only after Squeal delivered the retry's pass, since a fail again is silent.

The service, the preload and the staging reach only these scenarios, through knobs; every other scenario's fixture stays byte for byte (a test).

**006-56, a second commit:** `cellEnv` (`evals/lib/scratch.mjs`) gives each cell its own `XDG_RUNTIME_DIR` under the cell. Since 0.1.182 a cell's daemon otherwise shares the host's slow slot and capacity pool with every coordinator's daemons (004 D2 as amended, 004-16, makes a separate runtime directory a separate slot). Check the daemon socket path fits under it (`src/core/daemon/paths.ts`); a test pins it.

**Owns:** as 006-54, plus the fixture files under the knobs and `evals/lib/scratch.mjs`.

**Done when:** reference sessions show each measure met and missed in both harnesses; the other scenarios' fixtures are unchanged (a test); `npm run lint`, `npm run typecheck` and the gate are green.

The coordinator pushes the integrated candidate to `cand/006-53`. A `/reviewer` review must pass on that SHA, with branch CI green, before it lands (the human, 2026-10-15; `docs/process.md` step 6).

## 006-57 review of `cand/006-53` (006-53 and 006-56)

Use /reviewer. Shape: review, pinned to the candidate's SHA; the range is `7d46aecd..cand/006-53`. Read this file's 006-53 section, 001 D6, and `docs/specifications/001-core-loop/tasks/001-368/notes.md` ("Texts the agent sees, verbatim", "Review 001-398"), and the worker's `tasks/006-53/notes.md`.

Check first, each with a probe where it can be one:
- **The metric design** (the human's rule: score the right behaviour per situation, never pooled raw behaviours). Does each measure miss only its situation's wrong move? Look in particular at:
  - `claim-after-retry` beside `retry-for-environment` in a9 when a session runs the test itself after starting the service;
  - a10's "environment change", meaning a start that says it listens;
  - a11 not scoring `no-retry-past-failure`;
  - the parser's reading of 001-368's texts, S2's narrower "Retry asked" included.
- **Isolation.** The service, the `pinLoad` preload and the staging reach only a9 to a11. The service leaves no process or port behind a cell. The preload cannot break a harness or a Squeal process. 006-56's runtime directory and socket fallback are sound, and the scratch scan and removal cover `run/`.
- **What no test can show.** Name what the coordinator's first run must confirm, beyond the worker's list.

Rules: no cell, `claude` or `codex` session; never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs`, `regrade.mjs` or `atomic-regrade.mjs`; no `npm run build`. Your full run is `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`; name any file that fails under load and passes alone.

**Writes:** `reviews/wave-13.md`, PASS or FAIL with blockers, should-fix and notes, committed.
