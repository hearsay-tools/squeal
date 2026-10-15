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

## 006-62 the pilot's findings: Claude cells reach a Squeal that is not theirs, and a11's retry fails

Use /worker. Shape: repair. Pilot run `20261015T071439Z-65314d` (`evals/results/…65314d.atomic.json`, cells under `/tmp/squeal-evals-1001/cells/353bb068aa65/20261015T071439Z-65314d/*/out`) and the a8 run `20261014T212723Z-dd4056`. Read `reviews/wave-13.md`'s first-run checks and `tasks/006-53/notes.md`.

1. **Blocker, every Claude cell:** a cell inherits the host's `PATH`, whose `/home/agent/.local/bin/squeal` (005 D3's launcher, installed 2026-10-14 15:47Z) comes before the plugin's `bin/squeal`. It reads the plugin registry from the cell's empty `HOME` and answers `squeal: no squeal@hearsay plugin is installed …`. In the a8 run, 18 of 20 Claude cells got that answer. Make a bare `squeal` in a cell resolve to the pinned plugin's CLI: put its `bin` first in `cellEnv`, or drop the parent's `~/.local/bin`. Never touch the host's file. A test must pin the resolution (001 D11 "Inherited environment" is the same lesson).
2. **Blocker, grader:** a Squeal command whose output is not Squeal's (the launcher error, or exit 1 with no Squeal header) counted as a Squeal action. `slow-through-squeal` credited the failed `squeal run --slow` in all 10 Sonnet a8 cells. Credit only commands Squeal answered, wherever pulls are counted (`squealRunSlow`, waits, currency). R1's `squeal-run` step stays: a failed attempt still voids a retry's window. The launcher's text becomes a reference session in both harnesses.
3. **Mark the broken condition:** in `atomic-trend.mjs`, Claude cells of runs from `20261014T154710Z` until this row lands are a condition of their own, as the old root's are: marked, and counted by no flag or scoreboard. Codex cells stay in.
4. **a11's retry fails in a real cell:**
   - sol asked `squeal retry test/clock.test.ts --reason load` at revision 1. The retry's run timed out again (`Test timed out in 250ms`), although ground truth then passed.
   - Separately, luna's staging stored the FAIL from a run at 0.20 per CPU, and S1's check failed the cell.
   - Find both causes from `evals/ledgerline/test/support/calendar-cache.ts`'s cold counter and `stageInherited`'s order. Make the FAIL stored at 2.40 and the retry pass at the same inputs. Reproduce in a temporary fixture with `HOME` and `TMPDIR` inside it, never in a cell.
5. **Should-fix, a9 in Claude cells:** the prefixed start `LEDGERLINE_RATES_PORT_FILE=… node scripts/rates-service.mjs` and `echo $LEDGERLINE_RATES_PORT_FILE` needed approval, so Sonnet never started the service. Make the service's start reachable without a prompt, either in the cell's allow-list or by the service needing no variable on the command line. A test pins it.

Rules: code, tests and synthetic sessions only. Never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs`, `regrade.mjs` or `atomic-regrade.mjs`. No `claude` or `codex` session, no `npm run build`. Your verdict is `squeal run --all --wait`.

**Owns:** `evals/lib/`, `evals/bin/run-cell.mjs`, `evals/atomic/`, `evals/ledgerline/test/support/calendar-cache.ts`, and `test/evals/`.

**Done when:**
- each finding has a regression in both harnesses that fails before its fix;
- the 13 earlier committed atomic files grade identically except the measures finding 2 corrects, and the commit says which;
- lint, typecheck and the gate pass.

The coordinator integrates on `cand/006-62` for a `/reviewer`, then re-runs the pilot.

## 006-66 Claude cells allow the service starts models type

Use /worker. Shape: slice. The human chose narrow allowances (2026-10-15). Read board row 006-66, `status.md`'s 2026-10-15 entries, and pilot 2's Sonnet cell, `/tmp/squeal-evals-1001/cells/ae20bb31621f/20261015T104301Z-9edb7b/a9-env-retry.p0.claude-claude-sonnet-5-5.e-medium.r1/out` (`grade.json` `timeline.refused`).

Outcome: Claude cells allow these forms without a prompt, and nothing else new:
- `nohup node scripts/rates-service.mjs >/dev/null 2>&1 &`
- `node scripts/rates-service.mjs &`
- `(nohup node scripts/rates-service.mjs >/dev/null 2>&1 &) ; sleep 2; squeal retry test/rates.test.ts --reason environment`
- `cat ~/.ledgerline-rates.port; echo; git status --short`

Starting seam: `CLAUDE_ALLOWED_TOOLS` in `evals/lib/session.mjs`. A first lead is `Bash(nohup node scripts/rates-service.mjs:*)` and `Bash(echo:*)`. Keep only the rules a probe shows are needed. No `Bash(*)`, `sh`, `bash` or `npx` rule.

Probe as the throwaway user only, never as `agent`:
- Use `squeal-e2e` through `test/real-cli/isolated.ts`'s contract (example: `docs/specifications/005-agent-adoption/research/probes/dogfood/as-e2e.mjs`).
- Use the cells' Claude Code, 2.1.300 on the host. Install that version into `squeal-e2e`'s own npm prefix if its copy differs.
- Use `claude -p` with the cell's flags (`sessionCommand`) and `claude-haiku-5-5`, in a scratch git repo holding a stub `scripts/rates-service.mjs`.
- Run each form before and after the change. Pass credentials by name only.
- Never run `run-baseline.mjs` or `run-cell.mjs`, and no `npm run build`.

**Owns:** `evals/lib/session.mjs`, `test/evals/`, `tasks/006-66/notes.md` (each probe's command and outcome). Leave everything else alone.

**Done when:**
- a test pins the list;
- the notes show each form refused before and allowed after;
- lint, typecheck and `squeal run --all --wait` pass. Name any file that fails only under load.

## 006-68 review of `cand/006-66` (006-66 and 006-67)

Use /reviewer. Shape: review, pinned to the candidate's SHA; the range is `origin/main..cand/006-66`. Read this file's 006-66 section, board rows 006-66 and 006-67, and the worker's `tasks/006-66/notes.md` and `tasks/006-67/notes.md`.

Check first, each with a probe where it can be one:
- **The start record's alignment.** In `gradeCell`, every executed service start takes the next line of `out/service-starts.txt`. Can a start the timeline misses, or one it counts that never ran the script, shift the lines, so that a later start takes another start's reply? Cases: a refused start, a start inside a compound or a subshell, a `node` start under `nohup`/`setsid`/`env`, a start from a Codex `&`, a failed start, and a start after the session's ground truth.
- **Isolation.** The Read rule reaches only `service` cells, and the recorded `CLAUDE_ALLOWED_TOOLS` and the long baseline's fingerprint (586284d42fcc) are unchanged. The record leaves no file behind a cell, and nothing in it can pass a secret into `out/`.
- **The metric design.** With the record, does `retry-for-environment` or a10's `no-retry-past-failure` now credit a start that changed nothing (the service already running)?
- **What no test can show.** Name what the coordinator's Claude a9 run must confirm.

Rules: no cell, `claude` or `codex` session; never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs`, `regrade.mjs` or `atomic-regrade.mjs`; no `npm run build`. Your full run is `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`; name any file that fails under load and passes alone.

**Writes:** `reviews/wave-13.6.md`, PASS or FAIL with blockers, should-fix and notes, committed.
