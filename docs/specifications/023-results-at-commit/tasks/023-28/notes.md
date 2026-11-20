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

## Plan

1. Host: `deploy.sh inputs` (done before the VM was free), `deploy.sh copy` once the coordinator says the VM is free.
2. VM, one step per call, `bash -lc`: `setup.sh user node dirs claude hub install src`; `squeal --version` must print 0.1.577.
3. One trial session, s1-01, alone: shows whether `--run` now comes in, and what it costs in time and load on an empty store.
4. s1-02 to s1-10 and s2-01 to s2-10, interleaved, `batch.mjs --parallel 3` (the load gate stays: a session starts only while the 1-minute load is below 12).
5. s7: `setup.sh prepare s7-01` (the full warm-up, about 32 min in round 3) with no other session running, then s7-01's session with `--keep`, then `prepare-copy s7-0n s7-01` for 2 to 5 and their sessions with `--prepared`; then remove s7-01.
6. `summarize.mjs`, `deploy.sh fetch`, judge per session into `data/judgements.tsv`.
7. Teardown: `setup.sh teardown`, delete `~/work/<task id>/`, check no process of the user is left.
