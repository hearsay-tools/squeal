# 023-28 notes: how round 4 runs

Row 023-28, wave 17, 2026-11-20. The results go to `../../lessons.md`, "Round 4 (023-28)". These notes are the residue: what changed from round 3's harness, the plan, and where the data is.

## Scripts (`bin/`)

Round 3's scripts (`../023-23/bin/`, described in `../023-23/notes.md`), changed only where listed:

| Script | Change from round 3 |
|---|---|
| `deploy.sh` | Hub entry `c126136`, `install.sh` from `squeal--v0.1.577`; scratch `t/<id8>/w17`; no s5/s6 fixtures copied. The squawk bundle is the same history (to `0dfe0724c`). |
| `setup.sh` | User `squeal-w17`, case root `~squeal-w17/runs/w17`, Node under `/opt/squeal-w17`; `prepare` knows s1, s2 and s7 only. |
| `as-user.mjs` | User `squeal-w17`. |
| `session.mjs` | User and case root as above; ids `s1-nn`, `s2-nn`, `s7-nn`. |
| `batch.mjs` | Stops starting sessions at $10 (round 3: $25); ids s1, s2, s7. |
| `summarize.mjs` | Adds per session: `--run` used, each `squeal status --at` call with its revision (`atRevs`), calls naming HEAD itself (`HEAD`, `8be977ad6`, `20f03a431`; not `HEAD~1`), tool calls Claude Code moved to the background at its 120 s limit (`overruns`), and other tool calls of 120 s or more (`long`). |
| `prompts.json` | s1, s2, s7 exactly as round 3. |
| `results.mjs` (new) | Per session `squeal-results.txt`: every Bash call that names squeal or reads a background output, with its second, its duration and its whole output, and every text the agent said. The judgements are read from it. |
| `s7chain.sh` (new) | Waits for s7-01's batch, makes s7-02..05 by `prepare-copy`, runs them (`--prepared`, 3 at once), removes s7-01. |

## Plan

1. Host: `deploy.sh inputs` (done before the VM was free), `deploy.sh copy` once the coordinator says the VM is free.
2. VM, one step per call, `bash -lc`: `setup.sh user node dirs claude hub install src`; `squeal --version` must print 0.1.577.
3. One trial session, s1-01, alone: shows whether `--run` now comes in, and what it costs in time and load on an empty store.
4. s1-02 to s1-10 and s2-01 to s2-10, interleaved, `batch.mjs --parallel 3` (the load gate stays: a session starts only while the 1-minute load is below 12).
5. s7: `setup.sh prepare s7-01` (the full warm-up, about 32 min in round 3) with no other session running, then s7-01's session with `--keep`, then `prepare-copy s7-0n s7-01` for 2 to 5 and their sessions with `--prepared`; then remove s7-01.
6. `summarize.mjs`, `deploy.sh fetch`, judge per session into `data/judgements.tsv`.
7. Teardown: `setup.sh teardown`, delete `~/work/<task id>/`, check no process of the user is left.

## How it ran

Steps 1 to 7 ran as planned, 14:34Z to 16:25Z. The trial s1-01 passed `--run` with no hint and took 217 s, so the rest of s1 and s2 ran 3 at once. s7-01's warm-up took 34 min.

## Data (`data/`)

- `judgements.tsv`: per session, whether `--run` was used, the `--at` calls and their revisions, the calls on HEAD (and refusals), calls past 120 s (moved to the background), the answer's grade and reason, swaps, misread text.
- `summary.tsv`: as round 3's, plus `run`, `at_calls`, `at_head` (a `$c` loop variable is not counted: s1-03 and s1-05 are corrected in `judgements.tsv`), `overruns` (moved to the background by the 120 s limit) and `long_calls` (120 s or more under a timeout the agent raised).
- `<id>/`: `timeline.txt`, `summary.json`, `meta.json`, `after-stop.txt`, `squeal-results.txt`.
- `batch.log`; `s7-0n.prepare.txt` (s7-01: the warm-up; 02 to 05: the store copy's check); `leftover-after-s1s2.txt` (the processes s1-10's `--run` left behind).

The streams and transcripts were deleted with the work folder (the brief: delete everything at the end).

## Things that cost time

- Claude Code 2.1.327 reports a call moved to the background as "Command did not complete within its 120s timeout and was moved to the background"; round 3's detector matched only "Command running in background with ID". `summarize.mjs` matches both.
- Agents now often raise the Bash timeout to 600 s (`timeout: 600000`). Such calls pass 120 s without being moved, so count them separately.
- Short commit names (`20f03a4`) also name HEAD: the HEAD counter matches 7-character prefixes.
- `--run` in squawk starts the project's browser e2e environment in Squeal's checkout. Check `ps -u <user>` after each batch: s1-10 left a server and Chrome running.
- The user's `/tmp` collects the e2e harness's folders (63 after 25 sessions): `setup.sh teardown` does not remove them; `find /tmp -maxdepth 1 -user <user>` before `userdel`.
