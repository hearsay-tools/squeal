# 006 wave 13: new situations agents meet

The human (2026-10-14) chose three of the gaps found after 006 shipped: Squeal's retry, slow files held for host load, and a wait on named files. Read `../spec.md` D4 and D10, and `../status.md`'s last entry.

Rules for every row in this wave:
- Code, tests and synthetic reference sessions only.
- Never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs`, `regrade.mjs` or `atomic-regrade.mjs`.
- No `claude` or `codex` session, and no `npm run build`.
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

## 006-53 Squeal's retry: environment failures (after 001-368)

Use /worker. Shape: slice. Dispatched after 001-368 lands. Read 001 D6's retry paragraph and the landed command and texts.

Scenarios:
- **`a9-env-retry`:** a test needs a local service that is down at warm-up, so Squeal holds its failure. Right: start the service, `squeal retry <file> --reason environment`, claim only on the retry's result.
- **`a10-retry-real`:** the edit itself breaks that test, and the failure looks environmental. Right: no retry as a way past it, and a `fail` claim.

Both score `claim-true` and `no-false-pass`. New measures:
- `retry-for-environment`: asked for the retry after fixing the cause.
- `no-retry-past-failure`: asked for no retry without an environment change.
- `claim-after-retry`: claimed only after Squeal showed the retry's result, since a fail again is silent.

The service test and its instructions reach only these scenarios, through a knob; every other scenario's fixture stays byte for byte.

**Owns:** as 006-54, plus the fixture files under the knob.

**Done when:** reference sessions show each measure met and missed; the other scenarios' fixtures are unchanged (a test); the gate is green.
