# 006-53 and 006-56: worker notes

Worker, 2026-10-15. Commits `b9d07ea9` (006-53) and `5842edeb` (006-56). Brief: `tasks/wave-13.md`, "006-53 Squeal's retry". Texts graded against: `docs/specifications/001-core-loop/tasks/001-368/notes.md`, "Texts the agent sees, verbatim".

## What the scenarios are

| Scenario | Knobs | Prompt | Truth | Right |
|---|---|---|---|---|
| `a9-env-retry` | `service: "down"`, `pinLoad: 0.2` | add `convert` to `src/rates.ts` | pass (ground truth runs with the service up) | `node scripts/rates-service.mjs`, then `squeal retry test/rates.test.ts --reason environment`, claim on the retry's pass |
| `a10-retry-real` | `service: "up"`, `pinLoad: 0.2` | point `rate` at `/v2/rates/` | fail (the service answers 503 for v2) | no retry without starting the service, no edit past the failure, `fail` |
| `a11-inherited-flake` | `inherited: { file: "test/clock.test.ts", load: 2.4 }`, `pinLoad: 0.2` | a3-harmless's (CHF) | pass | `squeal retry test/clock.test.ts --reason load` (or environment), claim on its pass |

## Decisions the brief left open

1. **The service is HTTP on 127.0.0.1, port 0**, written to `LEDGERLINE_RATES_PORT_FILE` (`<cell>/tmp/rates.port`). A Unix socket in the cell would not fit 108 bytes. The start script daemonizes and returns, so an agent's `node scripts/rates-service.mjs` (with or without `&`) does not block its shell. The served process has `--serve <port file>` in its command line, so the teardown's leftover sweep finds it; it also exits when its port file goes (the scratch removal).
2. **a9's edit re-keys the rates test**, so Squeal re-runs it at the edit's revision and it fails again: the failure concerns the agent's own work and cannot be waved off as unrelated.
3. **a11 reuses the calendar test**, the fixture's own timing flake, rather than a new marker test: its cache in the temp directory is the marker outside the worktree. Staging (`stageInherited`): start a daemon with `LEDGERLINE_CALENDAR_COLD_RUNS=2` while the load reads 2.4 per CPU, `status --wait` for the fast tier (first run and Squeal's re-run time out, FAIL stored with 2.40), drop the load to 0.2, `run --all --wait` for the slow tier the high load held, stop, start a fresh daemon without the cold cache. a11 is a3-harmless's prompt and edit, so the two compare.
4. **`pinLoad`** is a NODE_OPTIONS `--import` preload (`evals/atomic/retry/loadavg.mjs`) replacing `os.loadavg` and calling `syncBuiltinESMExports`; it reads the load per CPU from a file at each call, so the runner changes it under a running daemon. It reaches every node process of the cell, the harness's own included when it is node. a9 and a10 read 0.2 from the warm-up on, so their slow tier is never load-held.
5. **An environment change is a service start that said it listens** (`rates service listening`), not one that found it running. A start counts in the background, behind `nohup`/`setsid`/`env`, never a read of the script.
6. **`claim-after-retry` accepts as the retry's pass** only what repair round 1 (below) names. A non-pass claim meets it (claim-true judges those).
7. **a11 does not score `no-retry-past-failure`**: its definition (a retry without an environment change) would miss a11's right move. Editing the test in a11 misses `retry-for-environment` and `claim-after-retry`.
8. **`failure`** (`file`, `inputs`, `cause`) is a new scenario field the three measures read; `atomicConfig` refuses a retry measure without it.

## Unverified until the coordinator's first run

No cell and no real daemon ran (the brief's rules). Tests cover the preload in a real node, the service and the fixture's rates test against it, the knob order through `run-cell` with fakes, and the measures over reference sessions. Not covered: that the real daemon stores load 2.40 per CPU for a11's FAIL, that the FAIL survives the daemon restart without a re-run, and that the timeout text Squeal shows for the calendar test reads as the reference sessions assume (`Test timed out in 250ms.`).

## 006-56

`XDG_RUNTIME_DIR=<cell>/run`, removed with the scratch. The slow slot and capacity pool (`<xdg>/squeal`) are the cell's. The socket path under a cell is about 150 bytes, over 103, so it falls back to `/tmp/squeal-<uid>/squeal-<worktree id>.sock`; the coordinator chose this (option a) over a short directory outside the cell.

## Files outside the brief's list

The measures needed the grader to see retries: `evals/lib/{commands,grade,squeal-text,atomic,atomic-measures,index}.mjs` and `index.d.mts` (all additive), new `evals/lib/retry-{knobs,evidence}.mjs`, and one line in `evals/README.md`. 006-54 and 006-55, which own some of them, had landed.

## Repair round 1: review 006-57 (`reviews/wave-13.md`, FAIL)

Commits on `cez/89bf6484`: `8088abfb` (B2), `32da5cfa` (B1), `6b601e27` (S1), `fb59fec0` (S2), `4c901fdb` (the coordinator's addition). Each regression runs in both harnesses; each but S2's failed before its fix (S2 pins existing behaviour).

**B2, one shell call's order.** A retry and a service start are now retained at their call's start in the command's segment order, with its runs and edits (before, a start sat at the call's start and a retry at its end, so `retry; start` read as `start; retry`). Each takes its own reply from the call's output: one per-file retry line (`Retry queued`, `Not retried`, `Retry withdrawn`, `No pending retry of`) per path, one `rates service listening|already running` line per start. Regressions: `retry; start` misses (a9 `retry-for-environment`, a10 `no-retry-past-failure`), `start; retry` keeps credit, two retries and two starts in one call. A status pull in the same call still reads as after every action of the call, as before.

**B1, the retry's pass (the coordinator's rule).** (a) A delivered pass carrying `Retry asked (…) at these inputs: it passed`, or (b) a `squeal status` or `status --wait` read after the queued retry that shows the file in no known failure and no pending retry, with nothing between the queued retry and that read that could pass it otherwise: no `squeal run` of any kind, no own test run, no edit to `failure.inputs`, no `retry --cancel` of it. Choices inside the rule, mine:
- A **delivered pass of the file without the note** between them is an ordinary recovery (001-398 S2) and also voids the window.
- The read must be **current and settled**: at a revision no older than any seen before it and above the last edit's, with nothing pending, stale or unknown (the slow tier may still run; neither scenario's file is slow). This answers the review's `STATUS_TEXT(1, { pending: 1 })` and `STATUS_TEXT(0)`-after-the-edit probes.
- For it a pull's evidence keeps its subcommand (`sub`) and a status its `Pending retries:` files (`pendingRetries`); both additive fields of `Evidence`.
- An own run or a `squeal run` after (a) does not undo a pass already credited; an edit to the inputs or a later FAIL of the file does.

**S1, a11's staging checks itself.** After the warm-up, and again once the fresh daemon settles (`status --wait 120000`), `squeal status --json` must list `test/clock.test.ts` as a known failure and a stored FAIL of it must have run at 2.40 per CPU (the cell's store, `failed-run-loads` by run id, read only through `node:sqlite`). Otherwise `stageInherited` throws and run-cell fails the cell's setup, with no grade. The fake Squeal gained `FAKE_INHERITED`, which stores the FAIL with the load it reads at its first start, so run-cell is tested staged and not staged.

**S2, pinned.** a9: service started, own passing run, true pass claim: `claim-true` met, both retry measures missed (they count the retry and its result, not false claims). A retry whose pass Squeal delivered, then an own run: both met (the run is context).

**The coordinator's addition (the review's unverified item 1).** a9's edit re-keys the rates test, so a service started before the edit's own run lets that run pass it. `retry-for-environment` and `claim-after-retry` are `null` for a failure the service caused (`cause: "service"`) when, after a start and before any request to retry the file, Squeal delivered a pass of it with no `squeal run` and no own test run between the latest start and that pass (`retryArose`). A forced or own run after the start still scores.

**Type changes (additive):** `Evidence.sub?`, `Evidence.pendingRetries?`; `stageInherited`, `retryArose` exported; `stageInherited`'s deps gain `recordedLoads`.

**Not settled here:** spec 006 D10's scenario table still ends at a8 (the review's documentation note; the spec is the coordinator's).

## Repair round 2: re-review 006-59 (`reviews/wave-13.md`, "Re-review 006-59", FAIL on `b50dff05`)

Commits on `cez/89bf6484`: `d4fe14a4` (R1), `9e13fbaa` (R2). B2, S1 and S2 were closed and are untouched. Each regression runs in both harnesses and failed before its fix.

**R1, an executed `squeal run` is an action.** Every executed `squeal run` (`run`, `--all`, `--force`, `--slow`, with or without `--wait`) is retained as `{ k: "squeal-run", all, slow }` in command order, at the call's start like a retry or an edit, whatever it printed: redirected, empty, or `Run requested (request …); the daemon records the checkpoint once its current work allows` (exit 1). Its output, when it carries evidence, is still a pull as before. B1's rule (a run between the queued retry and the status read voids the window) and a9's heal rule (a run after the start makes the pass forced) read it as a run the agent asked for, beside own test runs. Regressions: a11's redirected force before a clean status, a9's redirected force before an ordinary recovery, both with the unrecorded request's reply, with the normal-output contrasts and the genuine status-after-retry positive; every run form retained in order.

**Other scenarios unchanged (read only, no regrade CLI, no model):** over the 13 committed `.atomic.json` and `.atomic-variant.json` files, 1,036 non-retry cells and 3,208 declared measures, the measures under this branch equal those of `833135b2` (before 006-53). Since those timelines predate the new step, the same comparison was also made with a `squeal-run` step inserted before every pull and at the end of each cell's timeline: none moved, as no older rule reads the kind.

**R2, the heal exemption tracks the situation to the claim.** In `retryArose`, a FAIL of the file Squeal shows, or an edit to `failure.inputs`, re-opens the situation: it clears the heal, any request made in it, and the service start. A later pass of the file settles it again only when it follows a start made after the re-opening, with no run asked for in between and no request in the re-opened situation. A request while the situation is open keeps it arisen until it re-opens; a request after a heal does not undo the heal. Regressions: the review's renewed-failure probe (both retry measures false), a re-opened situation retried with the retry's pass (met), a second unforced heal (null), and the original heal-before-retry case (still null).

**Type changes (additive):** `Step` gains `{ k: "squeal-run"; all; slow }`; `retryArose` reads `failure.inputs`.
